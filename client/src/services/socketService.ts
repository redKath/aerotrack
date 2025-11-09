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

export interface FlightUpdateData {
  flights: FlightData[];
  timestamp: number;
  totalFlights: number;
  bounds?: {
    lamin: number;
    lomin: number;
    lamax: number;
    lomax: number;
  };
}

export interface FlightError {
  error: string;
  message: string;
  timestamp: number;
}

export class SocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(serverUrl?: string): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    // Use environment variable for production, fallback to localhost for dev
    const defaultUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
    const url = serverUrl || defaultUrl;

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

  onFlightError(callback: (error: FlightError) => void): void {
    this.socket?.on('flightError', callback);
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