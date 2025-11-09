import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import type { LatLngBounds } from 'leaflet';
import { FlightMarker } from './components/FlightMarker';
import { FlightInfoPanel } from './components/FlightInfoPanel';
import { StatusPanel } from './components/StatusPanel';
import { useFlightData } from './hooks/useFlightData';
import type { FlightData } from './services/socketService';
import 'leaflet/dist/leaflet.css';
import './App.css';

// Map bounds change handler component
const MapBoundsHandler: React.FC<{ onBoundsChange: (bounds: LatLngBounds) => void }> = ({ onBoundsChange }) => {
  const map = useMapEvents({
    moveend: () => {
      onBoundsChange(map.getBounds());
    },
    zoomend: () => {
      onBoundsChange(map.getBounds());
    },
  });

  return null;
};

const App: React.FC = () => {
  const [selectedFlight, setSelectedFlight] = useState<FlightData | null>(null);
  const [mapBounds, setMapBounds] = useState<LatLngBounds | null>(null);
  const { flights, stats, error, isLoading, updateBounds } = useFlightData();

  // Handle map bounds changes with debouncing
  const handleBoundsChange = useCallback(
    (bounds: LatLngBounds) => {
      setMapBounds(bounds);
      const boundsData = {
        lamin: bounds.getSouth(),
        lomin: bounds.getWest(),
        lamax: bounds.getNorth(),
        lomax: bounds.getEast(),
      };
      
      updateBounds(boundsData);
    },
    [updateBounds]
  );

  // Handle flight marker clicks
  const handleFlightClick = useCallback((flight: FlightData) => {
    setSelectedFlight(flight);
  }, []);

  // Close info panel
  const handleCloseInfo = useCallback(() => {
    setSelectedFlight(null);
  }, []);

  // Filter flights to only show those visible on the map (viewport culling)
  const visibleFlights = useMemo(() => {
    if (!mapBounds) return flights;
    
    return flights.filter(flight => {
      if (!flight.position) return false;
      
      const { latitude, longitude } = flight.position;
      return mapBounds.contains([latitude, longitude]);
    });
  }, [flights, mapBounds]);

  // Limit the number of rendered flights to prevent lag
  const limitedFlights = useMemo(() => {
    // Show max 500 flights for performance, prioritize by altitude and speed
    return visibleFlights
      .sort((a, b) => {
        const aAlt = a.position?.altitude || 0;
        const bAlt = b.position?.altitude || 0;
        const aSpeed = a.velocity?.speed || 0;
        const bSpeed = b.velocity?.speed || 0;
        return (bAlt + bSpeed) - (aAlt + aSpeed);
      })
      .slice(0, 500);
  }, [visibleFlights]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedFlight(null);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Main Map */}
      <MapContainer
        center={[20.0, 0.0]}
        zoom={3}
        className="w-full h-full"
        zoomControl={true}
        scrollWheelZoom={true}
        doubleClickZoom={true}
        touchZoom={true}
        keyboard={true}
        dragging={true}
        preferCanvas={true}
      >
        {/* Map Tiles */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        {/* Bounds change handler */}
        <MapBoundsHandler onBoundsChange={handleBoundsChange} />

        {/* Flight Markers - Only render limited visible flights */}
        {limitedFlights.map((flight) => (
          <FlightMarker
            key={flight.icao24}
            flight={flight}
            isSelected={selectedFlight?.icao24 === flight.icao24}
            onClick={handleFlightClick}
          />
        ))}
      </MapContainer>

      {/* Status Panel */}
      <StatusPanel
        stats={{
          ...stats,
          totalFlights: flights.length,
        }}
        error={error}
        isLoading={isLoading}
      />

      {/* Flight Info Panel */}
      <FlightInfoPanel
        flight={selectedFlight}
        onClose={handleCloseInfo}
      />

      {/* Help Text - Only show on desktop */}
      <div className="hidden md:block absolute bottom-4 left-4 bg-black/50 text-white text-xs px-3 py-2 rounded-lg backdrop-blur-sm">
        Click on aircraft to view details • Press ESC to close panels • Zoom in to see more flights
      </div>

      {/* Mobile Help Text */}
      <div className="md:hidden absolute bottom-2 left-2 right-2 bg-black/50 text-white text-xs px-2 py-1.5 rounded-lg backdrop-blur-sm text-center">
        Tap aircraft for details • Zoom in to see more flights
      </div>

      {/* Performance Info - Adjusted for mobile */}
      {limitedFlights.length < flights.length && (
        <div className="absolute bottom-12 md:bottom-4 right-2 md:right-4 
                        bg-yellow-600 text-white text-xs px-2 md:px-3 py-1 md:py-2 
                        rounded-lg backdrop-blur-sm max-w-[calc(100vw-1rem)]">
          <div className="md:hidden">
            {limitedFlights.length}/{flights.length} flights
          </div>
          <div className="hidden md:block">
            Showing {limitedFlights.length} of {flights.length} flights (zoom in for more)
          </div>
        </div>
      )}
    </div>
  );
};

export default App;