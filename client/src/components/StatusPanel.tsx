import React, { useState, useCallback, useEffect } from 'react';
import type { DataSourceState, FlightStats } from '../hooks/useFlightData';
import type { DataStatus } from '../services/socketService';

interface StatusPanelProps {
  stats: FlightStats;
  dataSource: DataSourceState;
  searchResultError: string | null;
  isLoading: boolean;
  onFlightSearch: (callsign: string) => void;
}

const DEGRADED_MESSAGES: Partial<Record<DataStatus, string>> = {
  upstream_unavailable: 'Live flight data is temporarily unavailable from OpenSky. Retrying automatically.',
  rate_limited: 'Live data is paused briefly due to API limits. Retrying shortly.',
  auth_failed: 'Live data source is being reconfigured. Retrying automatically.',
};

const getDataLabel = ({ status, stale }: DataSourceState): { text: string; dotClass: string } => {
  switch (status) {
    case 'ok':
      return stale ? { text: 'Last known', dotClass: 'bg-amber-500' } : { text: 'Live', dotClass: 'bg-green-500' };
    case 'pending':
      return { text: 'Waiting', dotClass: 'bg-gray-400' };
    case 'rate_limited':
      return { text: 'Paused', dotClass: 'bg-amber-500' };
    default:
      return { text: 'Unavailable', dotClass: 'bg-amber-500' };
  }
};

const formatAgo = (timestamp: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
};

// Safe way to get environment info
const getEnvironmentInfo = () => {
  const isDev = import.meta.env?.DEV || process.env.NODE_ENV === 'development';
  const serverUrl = import.meta.env?.VITE_SERVER_URL || 'localhost:3000';
  return { isDev, serverUrl };
};

export const StatusPanel: React.FC<StatusPanelProps> = ({ stats, dataSource, searchResultError, isLoading, onFlightSearch }) => {
  const { isDev, serverUrl } = getEnvironmentInfo();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick for the retry countdown and relative "updated" times
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
    if (!timestamp) return 'Waiting for live data…';
    const diff = now - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(timestamp).toLocaleTimeString();
  };

  const dataLabel = getDataLabel(dataSource);
  const degradedMessage = DEGRADED_MESSAGES[dataSource.status];
  const showStaleLabel = dataSource.stale && stats.totalFlights > 0;
  const retryInSec = dataSource.nextRetryAt !== null
    ? Math.max(0, Math.ceil((dataSource.nextRetryAt - now) / 1000))
    : null;

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
          {(searchError || searchResultError) && (
            <p className="text-xs text-red-600 mt-1">{searchError || searchResultError}</p>
          )}
        </form>
        {/* Connection Status (Socket.IO only) */}
        <div className="flex items-center space-x-2 mb-1">
          <div className={`w-2.5 h-2.5 md:w-3 md:h-3 rounded-full ${stats.isConnected ? 'bg-green-500 connection-indicator' : 'bg-red-500'}`}></div>
          <span className="text-xs md:text-sm font-medium">
            Server: {stats.isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* Data Source Status (OpenSky) */}
        <div className="flex items-center space-x-2 mb-2 md:mb-3">
          <div className={`w-2.5 h-2.5 md:w-3 md:h-3 rounded-full ${dataLabel.dotClass}`}></div>
          <span className="text-xs md:text-sm font-medium">Data: {dataLabel.text}</span>
        </div>

        {/* Show server URL in development */}
        {isDev && (
          <div className="text-xs text-gray-500 mb-2 break-all">
            Endpoint: {serverUrl}
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center space-x-2 mb-2 md:mb-3 text-blue-600">
            <div className="animate-spin w-3 h-3 md:w-4 md:h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            <span className="text-xs md:text-sm">Loading flights...</span>
          </div>
        )}

        {/* Degraded data source notice (non-blocking) */}
        {degradedMessage && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-2 mb-2 md:mb-3 max-w-xs" role="status">
            <p className="text-xs text-amber-800 break-words">{degradedMessage}</p>
            {showStaleLabel && stats.lastUpdate && (
              <p className="text-xs text-amber-700 mt-1">
                Showing last known positions · updated {formatAgo(stats.lastUpdate, now)}
              </p>
            )}
            {retryInSec !== null && (
              <p className="text-xs text-amber-700 mt-1">
                {retryInSec > 0 ? `Retrying in ${retryInSec}s` : 'Retrying now…'}
              </p>
            )}
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

          {(stats.isConnected || dataSource.origin === 'browser') && (
            <div className="flex items-center justify-between">
              <span className="text-xs md:text-sm text-gray-600">Source:</span>
              <span className="text-xs text-gray-500">
                {dataSource.origin === 'browser' ? 'OpenSky (direct)' : 'OpenSky'}
              </span>
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