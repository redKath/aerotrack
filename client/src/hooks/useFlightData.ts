import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { socketService } from '../services/socketService';
import type { DataStatus, FlightData, FlightUpdateData } from '../services/socketService';

export interface FlightStats {
  totalFlights: number;
  lastUpdate: number | null;
  connectedClients: number;
  isConnected: boolean;
}

export interface DataSourceState {
  status: DataStatus;
  stale: boolean;
  nextRetryAt: number | null; // epoch ms of the server's next retry, if backing off
}

// Debounce utility - fix the timeout type
const debounce = <T extends (...args: any[]) => void>(func: T, wait: number): T => {
  let timeout: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
};

export const useFlightData = (serverUrl?: string) => {
  const [flights, setFlights] = useState<Map<string, FlightData>>(new Map());
  const [stats, setStats] = useState<FlightStats>({
    totalFlights: 0,
    lastUpdate: null,
    connectedClients: 1,
    isConnected: false,
  });
  const [dataSource, setDataSource] = useState<DataSourceState>({
    status: 'pending',
    stale: false,
    nextRetryAt: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  // Use refs to track component lifecycle and prevent unnecessary re-renders
  const isMountedRef = useRef(true);
  const updateCountRef = useRef(0);
  const lastUpdateTimeRef = useRef<number>(0);

  // Optimize flight updates with batching and reduced re-renders
  const updateFlights = useCallback((newFlightData: FlightUpdateData) => {
    if (!isMountedRef.current) return;

    const now = Date.now();
    const { status, flights: newFlights, lastUpdated, stale, nextRetryInSec } = newFlightData;
    const timestamp = lastUpdated ? Date.parse(lastUpdated) : null;

    // Data source status is always applied, independent of the flight throttle
    setDataSource({
      status,
      stale,
      nextRetryAt: nextRetryInSec !== undefined ? now + nextRetryInSec * 1000 : null,
    });
    setStats(prev => ({ ...prev, lastUpdate: timestamp }));
    if (status !== 'pending' || newFlights.length > 0) {
      setIsLoading(false);
    }

    // Throttle flight updates to maximum 2 per second to reduce lag
    if (now - lastUpdateTimeRef.current < 500 || newFlights.length === 0) {
      return;
    }
    lastUpdateTimeRef.current = now;

    setFlights(prevFlights => {
      const updatedFlights = new Map(prevFlights);
      const newFlightIds = new Set<string>();
      let hasChanges = false;

      // Update existing flights and add new ones
      newFlights.forEach(flight => {
        if (flight.position) {
          const existing = updatedFlights.get(flight.icao24);
          // Only update if position actually changed significantly
          if (!existing || 
              Math.abs(existing.position!.latitude - flight.position.latitude) > 0.0001 ||
              Math.abs(existing.position!.longitude - flight.position.longitude) > 0.0001 ||
              Math.abs(existing.position!.altitude - flight.position.altitude) > 100) {
            updatedFlights.set(flight.icao24, flight);
            hasChanges = true;
          }
          newFlightIds.add(flight.icao24);
        }
      });

      // Remove stale flights less frequently to reduce processing
      if (updateCountRef.current % 10 === 0) { // Only every 10th update
        const fiveMinutesAgo = ((timestamp ?? now) - 300000) / 1000;
        for (const [icao24, flight] of updatedFlights) {
          if (!newFlightIds.has(icao24) && flight.lastUpdate < fiveMinutesAgo) {
            updatedFlights.delete(icao24);
            hasChanges = true;
          }
        }
      }

      updateCountRef.current++;
      return hasChanges ? updatedFlights : prevFlights;
    });

    setStats(prev => ({ ...prev, totalFlights: newFlights.length }));
  }, []);

  // Debounce bounds updates to prevent excessive API calls
  const debouncedUpdateBounds = useMemo(
    () => debounce((bounds: { lamin: number; lomin: number; lamax: number; lomax: number }) => {
      socketService.updateBounds(bounds);
    }, 1000),
    []
  );

  const updateBounds = useCallback((bounds: { lamin: number; lomin: number; lamax: number; lomax: number }) => {
    debouncedUpdateBounds(bounds);
  }, [debouncedUpdateBounds]);

  useEffect(() => {
    isMountedRef.current = true;
    
    const socket = socketService.connect(serverUrl);
    
    // Set up event listeners
    socketService.onFlightUpdate(updateFlights);

    // Track connection status
    const updateConnectionStatus = () => {
      if (!isMountedRef.current) return;
      setStats(prev => ({ ...prev, isConnected: socketService.getConnectionStatus() }));
    };

    socket.on('connect', updateConnectionStatus);
    socket.on('disconnect', updateConnectionStatus);

    // Initial connection status
    updateConnectionStatus();

    return () => {
      isMountedRef.current = false;
      socketService.disconnect();
    };
  }, [serverUrl, updateFlights]);

  // Memoize the flights array to prevent unnecessary re-renders
  const flightsArray = useMemo(() => Array.from(flights.values()), [flights]);

  return {
    flights: flightsArray,
    stats,
    dataSource,
    isLoading,
    updateBounds,
  };
};