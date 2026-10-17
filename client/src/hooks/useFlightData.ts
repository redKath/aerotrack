import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { socketService } from '../services/socketService';
import type { DataStatus, FlightData, FlightUpdateData } from '../services/socketService';
import { DirectFetchError, fetchFlightsDirect } from '../services/openSkyDirect';
import type { Bounds } from '../services/openSkyDirect';

export interface FlightStats {
  totalFlights: number;
  lastUpdate: number | null;
  connectedClients: number;
  isConnected: boolean;
}

export interface DataSourceState {
  status: DataStatus;
  stale: boolean;
  nextRetryAt: number | null; // epoch ms of the next retry, if backing off
  origin: 'server' | 'browser'; // 'browser' = fetched directly from OpenSky by this page
}

interface DirectState {
  status: DataStatus | null; // null until the first direct fetch completes
  nextRetryAt: number | null;
}

// Browser fallback via the /opensky proxy: anonymous quota (~400 credits/day, 1-4 per request) is shared by all visitors
const DIRECT_POLL_INTERVAL = 30000;
const DIRECT_MAX_BACKOFF = 5 * 60 * 1000;
const DIRECT_MIN_GAP = 10000; // minimum time between direct fetches triggered by map moves
const SERVER_OFFLINE_GRACE = 15000;
const DEGRADED_STATUSES: DataStatus[] = ['upstream_unavailable', 'auth_failed', 'rate_limited'];

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
  const [serverState, setServerState] = useState<Omit<DataSourceState, 'origin'>>({
    status: 'pending',
    stale: false,
    nextRetryAt: null,
  });
  const [directState, setDirectState] = useState<DirectState>({ status: null, nextRetryAt: null });
  const [serverOffline, setServerOffline] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Use refs to track component lifecycle and prevent unnecessary re-renders
  const isMountedRef = useRef(true);
  const updateCountRef = useRef(0);
  const lastUpdateTimeRef = useRef<number>(0);
  const boundsRef = useRef<Bounds | null>(null);
  const directOkRef = useRef(false);
  const directFetchNowRef = useRef<(() => void) | null>(null);

  // Merge new flight positions into the map, skipping insignificant changes
  const mergeFlights = useCallback((newFlights: FlightData[], timestamp: number) => {
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
        const fiveMinutesAgo = (timestamp - 300000) / 1000;
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

    setStats(prev => ({
      ...prev,
      totalFlights: newFlights.length,
      lastUpdate: Math.max(prev.lastUpdate ?? 0, timestamp),
    }));
  }, []);

  // Optimize flight updates with batching and reduced re-renders
  const updateFlights = useCallback((newFlightData: FlightUpdateData) => {
    if (!isMountedRef.current) return;

    const now = Date.now();
    const { status, flights: newFlights, lastUpdated, stale, nextRetryInSec } = newFlightData;

    // Data source status is always applied, independent of the flight throttle
    setServerState({
      status,
      stale,
      nextRetryAt: nextRetryInSec !== undefined ? now + nextRetryInSec * 1000 : null,
    });
    if (status !== 'pending' || newFlights.length > 0) {
      setIsLoading(false);
    }

    // Don't overwrite fresher browser-fetched positions with the server's stale snapshot
    if (newFlights.length === 0 || (status !== 'ok' && directOkRef.current)) {
      return;
    }

    // Throttle flight updates to maximum 2 per second to reduce lag
    if (now - lastUpdateTimeRef.current < 500) {
      return;
    }
    lastUpdateTimeRef.current = now;

    mergeFlights(newFlights, lastUpdated ? Date.parse(lastUpdated) : now);
  }, [mergeFlights]);

  // Debounce bounds updates to prevent excessive API calls
  const debouncedUpdateBounds = useMemo(
    () => debounce((bounds: Bounds) => {
      socketService.updateBounds(bounds);
      directFetchNowRef.current?.();
    }, 1000),
    []
  );

  const updateBounds = useCallback((bounds: Bounds) => {
    boundsRef.current = bounds;
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

  // Treat the server as offline only after a grace period (e.g. Render cold start)
  useEffect(() => {
    if (stats.isConnected) {
      setServerOffline(false);
      return;
    }
    const timer = setTimeout(() => setServerOffline(true), SERVER_OFFLINE_GRACE);
    return () => clearTimeout(timer);
  }, [stats.isConnected]);

  const fallbackActive = serverOffline || DEGRADED_STATUSES.includes(serverState.status);

  // Browser fallback: poll OpenSky directly while the server can't provide live data
  useEffect(() => {
    if (!fallbackActive) {
      directOkRef.current = false;
      setDirectState({ status: null, nextRetryAt: null });
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let lastFetchAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      if (inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      lastFetchAt = Date.now();
      let delay = DIRECT_POLL_INTERVAL;
      try {
        const directFlights = await fetchFlightsDirect(boundsRef.current);
        if (cancelled) return;
        failures = 0;
        directOkRef.current = true;
        mergeFlights(directFlights, Date.now());
        setDirectState({ status: 'ok', nextRetryAt: null });
        setIsLoading(false);
      } catch (error) {
        if (cancelled) return;
        failures++;
        directOkRef.current = false;
        const status = error instanceof DirectFetchError ? error.status : 'upstream_unavailable';
        console.warn('Direct OpenSky fetch failed:', status, error instanceof Error ? error.message : error);
        delay = status === 'rate_limited'
          ? DIRECT_MAX_BACKOFF
          : Math.min(DIRECT_POLL_INTERVAL * 2 ** (failures - 1), DIRECT_MAX_BACKOFF);
        setDirectState({ status, nextRetryAt: Date.now() + delay });
      } finally {
        inFlight = false;
      }
      if (!cancelled) timer = setTimeout(run, delay);
    };

    // Fetch right away when the map moves, unless backing off or fetched very recently
    directFetchNowRef.current = () => {
      if (failures === 0 && Date.now() - lastFetchAt >= DIRECT_MIN_GAP) run();
    };

    run();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      directFetchNowRef.current = null;
    };
  }, [fallbackActive, mergeFlights]);

  const dataSource = useMemo((): DataSourceState => {
    if (!fallbackActive) {
      return { ...serverState, origin: 'server' };
    }
    if (directState.status === 'ok') {
      return { status: 'ok', stale: false, nextRetryAt: null, origin: 'browser' };
    }
    if (directState.status === 'rate_limited') {
      return { status: 'rate_limited', stale: true, nextRetryAt: directState.nextRetryAt, origin: 'browser' };
    }
    // Both sources failing (or first direct fetch still in progress): show the server's view
    const retryTimes = [serverState.nextRetryAt, directState.nextRetryAt].filter((t): t is number => t !== null);
    return {
      status: serverOffline && serverState.status === 'pending' && directState.status ? 'upstream_unavailable' : serverState.status,
      stale: directState.status !== null || serverState.stale,
      nextRetryAt: retryTimes.length > 0 ? Math.min(...retryTimes) : null,
      origin: 'server',
    };
  }, [fallbackActive, serverState, directState, serverOffline]);

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
