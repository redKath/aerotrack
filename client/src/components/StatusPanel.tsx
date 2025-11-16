import React, { useState, useCallback } from 'react';
import type { FlightStats } from '../hooks/useFlightData';

interface StatusPanelProps {
  stats: FlightStats;
  error: string | null;
  isLoading: boolean;
  onFlightSearch: (callsign: string) => void;
}

// Safe way to get environment info
const getEnvironmentInfo = () => {
  const isDev = import.meta.env?.DEV || process.env.NODE_ENV === 'development';
  const serverUrl = import.meta.env?.VITE_SERVER_URL || 'localhost:3000';
  return { isDev, serverUrl };
};

export const StatusPanel: React.FC<StatusPanelProps> = ({ stats, error, isLoading, onFlightSearch }) => {
  const { isDev, serverUrl } = getEnvironmentInfo();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim().length < 2) {
      setSearchError('Please enter at least 2 characters.');
      return;
    }
    setSearchError(null);
    onFlightSearch(searchQuery.trim().toUpperCase());
  }, [searchQuery, onFlightSearch]);

  const formatLastUpdate = (timestamp: number | null): string => {
    if (!timestamp) return 'Never';
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="absolute top-2 left-2 md:top-4 md:left-4 z-40 max-w-[calc(100vw-1rem)] md:max-w-none">
      <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 md:p-4 min-w-48 md:min-w-64">

        <form onSubmit={handleSearch} className="mb-3">
          <label htmlFor="flight-search" className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
            Search Flight (e.g., UAL123)
          </label>
          <div className="flex space-x-2">
            <input
              id="flight-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter callsign..."
              className="flex-1 px-2 py-1 text-xs md:text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={10}
            />
            <button
              type="submit"
              className="px-3 py-1 bg-blue-600 text-white text-xs md:text-sm rounded-md hover:bg-blue-700 transition-colors"
            >
              Search
            </button>
          </div>
          {searchError && (
            <p className="text-xs text-red-600 mt-1">{searchError}</p>
          )}
        </form>
        {/* Connection Status */}
        <div className="flex items-center space-x-2 mb-2 md:mb-3">
          <div className={`w-2.5 h-2.5 md:w-3 md:h-3 rounded-full ${stats.isConnected ? 'bg-green-500 connection-indicator' : 'bg-red-500'}`}></div>
          <span className="text-xs md:text-sm font-medium">
            {stats.isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* Show server URL in development */}
        {isDev && (
          <div className="text-xs text-gray-500 mb-2 break-all">
            Server: {serverUrl}
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center space-x-2 mb-2 md:mb-3 text-blue-600">
            <div className="animate-spin w-3 h-3 md:w-4 md:h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            <span className="text-xs md:text-sm">Loading flights...</span>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-2 md:p-3 mb-2 md:mb-3">
            <div className="flex items-center space-x-2">
              <svg className="w-3 h-3 md:w-4 md:h-4 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="text-xs md:text-sm text-red-700 font-medium">Error</span>
            </div>
            <p className="text-xs text-red-600 mt-1 break-words">{error}</p>
          </div>
        )}

        {/* Statistics */}
        <div className="space-y-1.5 md:space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs md:text-sm text-gray-600">Flights:</span>
            <span className={`text-xs md:text-sm font-bold px-2 py-1 rounded-full flight-count-badge ${stats.totalFlights > 0 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>
              {stats.totalFlights.toLocaleString()}
            </span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-xs md:text-sm text-gray-600">Updated:</span>
            <span className="text-xs text-gray-500">
              {formatLastUpdate(stats.lastUpdate)}
            </span>
          </div>

          {stats.isConnected && (
            <div className="flex items-center justify-between">
              <span className="text-xs md:text-sm text-gray-600">Source:</span>
              <span className="text-xs text-gray-500">OpenSky</span>
            </div>
          )}
        </div>

        {/* Compact Legend for Mobile */}
        <div className="mt-3 pt-2 border-t border-gray-200">
          <h4 className="text-xs font-semibold text-gray-700 mb-1.5">Status</h4>
          <div className="grid grid-cols-2 md:grid-cols-1 gap-1">
            <div className="flex items-center space-x-1.5">
              <div className="w-1.5 h-1.5 bg-gray-500 rounded-full"></div>
              <span className="text-xs text-gray-600">Ground</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
              <span className="text-xs text-gray-600">Low Alt</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
              <span className="text-xs text-gray-600">Med Alt</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-1.5 h-1.5 bg-purple-500 rounded-full"></div>
              <span className="text-xs text-gray-600">High Alt</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};