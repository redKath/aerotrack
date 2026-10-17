import { io, Socket } from 'socket.io-client';

export interface FlightData {
  icao24: string;
  callsign: string;
  originCountry: string;
  position: {
    latitude: number;
    longitude: number;
    altitude: number;
  } | null;
  velocity: {
    speed: number;
    heading: number;
    verticalRate: number;
  } | null;
  onGround: boolean;
  lastUpdate: number;
  category: string;
}

// Status of the OpenSky data source, reported by the server ('pending' = no fetch completed yet)
export type DataStatus = 'ok' | 'upstream_unavailable' | 'auth_failed' | 'rate_limited' | 'pending';

export interface FlightUpdateData {
  status: DataStatus;
  flights: FlightData[];          // live or last-known
  lastUpdated: string | null;     // ISO time of the data shown
  stale: boolean;
  nextRetryInSec?: number;
  bounds?: {
    lamin: number;
    lomin: number;
    lamax: number;
    lomax: number;
  } | null;
}

// Safe way to get environment variables
const getServerUrl = (): string => {
  // Check if we're in a Vite environment
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
  }
  
  // Fallback for other environments
  return 'http://localhost:3000';
};

export class SocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(serverUrl?: string): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    // Use provided URL or get from environment
    const url = serverUrl || getServerUrl();

    console.log('🔌 Connecting to server:', url);

    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true,
      timeout: 10000,
      forceNew: true,
    });

    this.setupEventListeners();
    return this.socket;
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('✅ Connected to flight data server');
      this.reconnectAttempts = 0;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ Disconnected from server:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('🔴 Connection error:', error);
      this.handleReconnection();
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`🔄 Reconnected after ${attemptNumber} attempts`);
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('🔄 Reconnection failed:', error);
    });
  }

  private handleReconnection(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    }
  }

  updateBounds(bounds: { lamin: number; lomin: number; lamax: number; lomax: number }): void {
    if (this.socket?.connected) {
      this.socket.emit('updateBounds', bounds);
    }
  }

  onFlightUpdate(callback: (data: FlightUpdateData) => void): void {
    this.socket?.on('flightUpdate', callback);
  }

  getConnectionStatus(): boolean {
    return this.socket?.connected || false;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const socketService = new SocketService();