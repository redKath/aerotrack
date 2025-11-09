import React, { useMemo } from 'react';
import { Marker, Tooltip } from 'react-leaflet';
import { DivIcon } from 'leaflet';
import type { FlightData } from '../services/socketService';

interface FlightMarkerProps {
  flight: FlightData;
  isSelected: boolean;
  onClick: (flight: FlightData) => void;
}

// Pre-create icon cache to avoid recreating icons
const iconCache = new Map<string, DivIcon>();

// Create a simple airplane SVG instead of using Lucide React
const createAirplaneSVG = (color: string, size: number, rotation: number): string => {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform: rotate(${rotation}deg)">
      <path fill="${color}" d="M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z"/>
    </svg>
  `;
};

const createFlightIcon = (flight: FlightData, isSelected: boolean): DivIcon => {
  // Create a cache key
  const cacheKey = `${flight.icao24}-${isSelected}-${flight.onGround}-${flight.position?.altitude || 0}-${flight.velocity?.heading || 0}-${flight.category}`;
  
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  const { category, onGround, velocity } = flight;
  
  // Determine color based on altitude/status
  let color = '#3b82f6'; // blue-500
  if (onGround) {
    color = '#6b7280'; // gray-500
  } else if (flight.position && flight.position.altitude > 30000) {
    color = '#8b5cf6'; // purple-500
  } else if (flight.position && flight.position.altitude > 15000) {
    color = '#3b82f6'; // blue-500
  } else {
    color = '#10b981'; // green-500
  }

  // Determine size based on category
  let size = 20;
  if (category === 'Heavy' || category === 'Large') {
    size = 28;
  } else if (category === 'High Vortex Large') {
    size = 32;
  }

  // Rotation based on heading
  const rotation = velocity?.heading || 0;

  const iconHtml = `
    <div class="flight-marker ${isSelected ? 'selected' : ''}" style="width: ${size + 8}px; height: ${size + 8}px; display: flex; align-items: center; justify-content: center;">
      ${createAirplaneSVG(color, size, rotation)}
      ${isSelected ? `<div class="selection-ring"></div>` : ''}
    </div>
  `;

  const icon = new DivIcon({
    html: iconHtml,
    className: 'flight-icon-wrapper',
    iconSize: [size + 8, size + 8],
    iconAnchor: [(size + 8) / 2, (size + 8) / 2],
  });

  // Cache the icon but limit cache size
  if (iconCache.size > 1000) {
    iconCache.clear();
  }
  iconCache.set(cacheKey, icon);

  return icon;
};

export const FlightMarker: React.FC<FlightMarkerProps> = React.memo(({ flight, isSelected, onClick }) => {
  if (!flight.position) return null;

  const icon = useMemo(() => createFlightIcon(flight, isSelected), [
    flight.icao24,
    flight.onGround,
    flight.position?.altitude,
    flight.velocity?.heading,
    flight.category,
    isSelected
  ]);

  const tooltipContent = useMemo(() => {
    const formatAltitude = (altitude: number): string => {
      if (altitude < 1000) return `${Math.round(altitude)}ft`;
      return `${(altitude / 1000).toFixed(1)}kft`;
    };

    const formatSpeed = (speed: number): string => {
      return `${Math.round(speed)} kts`;
    };

    return (
      <div className="text-xs font-medium">
        <div className="font-bold text-blue-800">{flight.callsign}</div>
        <div className="text-gray-600">
          {flight.onGround ? 'On Ground' : formatAltitude(flight.position!.altitude)}
        </div>
        {!flight.onGround && flight.velocity && (
          <div className="text-gray-600">{formatSpeed(flight.velocity.speed)}</div>
        )}
      </div>
    );
  }, [flight.callsign, flight.onGround, flight.position?.altitude, flight.velocity?.speed]);

  const handleClick = useMemo(() => () => onClick(flight), [onClick, flight]);

  return (
    <Marker
      position={[flight.position.latitude, flight.position.longitude]}
      icon={icon}
      eventHandlers={{
        click: handleClick,
      }}
    >
      <Tooltip permanent={isSelected} direction="top" offset={[0, -15]}>
        {tooltipContent}
      </Tooltip>
    </Marker>
  );
});

FlightMarker.displayName = 'FlightMarker';