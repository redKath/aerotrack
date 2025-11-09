import React from 'react';
import type { FlightData } from '../services/socketService';

interface FlightInfoPanelProps {
  flight: FlightData | null;
  onClose: () => void;
}

export const FlightInfoPanel: React.FC<FlightInfoPanelProps> = ({ flight, onClose }) => {
  if (!flight) return null;

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatAltitude = (altitude: number): string => {
    return `${altitude.toLocaleString()} ft (${Math.round(altitude * 0.3048)} m)`;
  };

  const formatSpeed = (speed: number): string => {
    const kmh = Math.round(speed * 1.852);
    return `${Math.round(speed)} kts (${kmh} km/h)`;
  };

  const formatCoordinates = (lat: number, lon: number): string => {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lon).toFixed(4)}°${lonDir}`;
  };

  const getStatusColor = (): string => {
    if (flight.onGround) return 'bg-gray-100 text-gray-800';
    if (flight.position && flight.position.altitude > 30000) return 'bg-purple-100 text-purple-800';
    if (flight.position && flight.position.altitude > 15000) return 'bg-blue-100 text-blue-800';
    return 'bg-green-100 text-green-800';
  };

  const getVerticalRateDisplay = (): string => {
    if (!flight.velocity?.verticalRate) return 'Level';
    const rate = Math.round(flight.velocity.verticalRate);
    if (rate > 0) return `↗ ${rate} ft/min`;
    if (rate < 0) return `↘ ${Math.abs(rate)} ft/min`;
    return 'Level';
  };

  return (
    <>
      {/* Mobile Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={onClose}></div>
      
      {/* Panel Container */}
      <div className="fixed inset-x-0 bottom-0 md:absolute md:top-4 md:right-4 md:inset-x-auto 
                      w-full md:w-80 max-h-[70vh] md:max-h-96 
                      info-panel rounded-t-lg md:rounded-lg shadow-2xl z-50 overflow-hidden">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-3 md:p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg md:text-xl font-bold truncate">{flight.callsign}</h2>
              <p className="text-blue-100 text-xs md:text-sm">ICAO: {flight.icao24.toUpperCase()}</p>
            </div>
            <button
              onClick={onClose}
              className="text-blue-100 hover:text-white transition-colors duration-200 ml-2 p-1"
            >
              <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-3 md:p-4 bg-white custom-scrollbar overflow-y-auto 
                        max-h-[calc(70vh-80px)] md:max-h-80">
          <div className="space-y-4">
            
            {/* Status Badge */}
            <div className="flex items-center space-x-2 flex-wrap">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor()}`}>
                {flight.onGround ? '🛬 On Ground' : '✈️ In Flight'}
              </span>
            </div>

            {/* Basic Info */}
            <div className="grid grid-cols-1 gap-3">
              <div className="bg-gray-50 p-3 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Aircraft Information</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500 flex-shrink-0">Origin Country:</span> 
                    <span className="font-medium text-right">{flight.originCountry}</span>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500 flex-shrink-0">Category:</span> 
                    <span className="font-medium text-right">{flight.category}</span>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500 flex-shrink-0">Last Update:</span> 
                    <span className="font-medium text-right text-xs">{formatTime(flight.lastUpdate)}</span>
                  </div>
                </div>
              </div>

              {/* Position Information */}
              {flight.position && (
                <div className="bg-blue-50 p-3 rounded-lg">
                  <h3 className="text-sm font-semibold text-blue-700 mb-2">Position</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between items-start">
                      <span className="text-blue-600 flex-shrink-0">Coordinates:</span> 
                      <span className="font-medium font-mono text-right text-xs">
                        {formatCoordinates(flight.position.latitude, flight.position.longitude)}
                      </span>
                    </div>
                    <div className="flex justify-between items-start">
                      <span className="text-blue-600 flex-shrink-0">Altitude:</span> 
                      <span className="font-medium text-right">{formatAltitude(flight.position.altitude)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Velocity Information */}
              {flight.velocity && !flight.onGround && (
                <div className="bg-green-50 p-3 rounded-lg">
                  <h3 className="text-sm font-semibold text-green-700 mb-2">Flight Data</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between items-start">
                      <span className="text-green-600 flex-shrink-0">Speed:</span> 
                      <span className="font-medium text-right">{formatSpeed(flight.velocity.speed)}</span>
                    </div>
                    <div className="flex justify-between items-start">
                      <span className="text-green-600 flex-shrink-0">Heading:</span> 
                      <span className="font-medium text-right">{Math.round(flight.velocity.heading)}°</span>
                    </div>
                    <div className="flex justify-between items-start">
                      <span className="text-green-600 flex-shrink-0">Vertical Rate:</span> 
                      <span className="font-medium text-right">{getVerticalRateDisplay()}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};