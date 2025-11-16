import { Server as SocketIOServer, Socket } from 'socket.io';
import axios from 'axios';
import { AuthManager, getOpenSkyAuthHeader } from '../middlewares/authMiddleware';
import config from '../config/config';

interface FlightData {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  timePosition: number | null;
  lastContact: number;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
  squawk: string | null;
  spi: boolean;
  positionSource: number;
  category: number;
}

interface ProcessedFlightData {
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

interface GeographicBounds {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

export class FlightDataService {
  private io: SocketIOServer;
  private pollingInterval: NodeJS.Timeout | null = null;
  private connectedClients: Set<string> = new Set();
  private clientBounds: Map<string, GeographicBounds> = new Map();
  private lastFlightData: ProcessedFlightData[] = [];
  private readonly POLLING_INTERVAL = 15000; // 15 seconds
  private readonly OPENSKY_API_URL = config.openSky.apiBaseUrl;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  public handleClientConnection(socket: Socket): void {
    this.connectedClients.add(socket.id);
    
    // Send last known flight data immediately
    if (this.lastFlightData.length > 0) {
      socket.emit('flightUpdate', {
        flights: this.lastFlightData,
        timestamp: Date.now(),
        totalFlights: this.lastFlightData.length
      });
    }

    // Start polling if this is the first client
    if (this.connectedClients.size === 1) {
      this.startPolling();
    }

    console.log(`Flight data service: ${this.connectedClients.size} clients connected`);
  }

  public handleClientDisconnection(socket: Socket): void {
    this.connectedClients.delete(socket.id);
    this.clientBounds.delete(socket.id);

    // Stop polling if no clients are connected
    if (this.connectedClients.size === 0) {
      this.stopPolling();
    }

    console.log(`Flight data service: ${this.connectedClients.size} clients connected`);
  }

  public updateClientBounds(clientId: string, bounds: GeographicBounds): void {
    this.clientBounds.set(clientId, bounds);
    // Immediately fetch data for the new bounds
    this.fetchAndBroadcastFlightData();
  }

  private startPolling(): void {
    if (this.pollingInterval) {
      return; // Already polling
    }

    console.log('Starting flight data polling...');
    
    // Fetch immediately
    this.fetchAndBroadcastFlightData();
    
    // Then poll every 15 seconds
    this.pollingInterval = setInterval(() => {
      this.fetchAndBroadcastFlightData();
    }, this.POLLING_INTERVAL);
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      console.log('Stopping flight data polling...');
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async fetchAndBroadcastFlightData(): Promise<void> {
    try {
      const authManager = AuthManager.getInstance();
      const token = await authManager.getValidOpenSkyToken();
      
      // Determine bounds for the request
      const bounds = this.getOptimalBounds();
      const params = new URLSearchParams();
      
      if (bounds) {
        params.append('lamin', bounds.lamin.toString());
        params.append('lomin', bounds.lomin.toString());
        params.append('lamax', bounds.lamax.toString());
        params.append('lomax', bounds.lomax.toString());
      }

      const url = `${this.OPENSKY_API_URL}/states/all${params.toString() ? `?${params.toString()}` : ''}`;
      
      const response = await axios.get(url, {
        headers: getOpenSkyAuthHeader(token),
        timeout: 30000,
      });

      const processedData = this.processFlightData(response?.data);
      this.lastFlightData = processedData;

      // Broadcast to all connected clients
      this.io.emit('flightUpdate', {
        flights: processedData,
        timestamp: Date.now(),
        totalFlights: processedData.length,
        bounds: bounds
      });

      console.log(`Broadcasting flight data: ${processedData.length} flights to ${this.connectedClients.size} clients`);

    } catch (error) {
      console.error('Error fetching flight data:', error);
      
      // Emit error to clients
      this.io.emit('flightError', {
        error: 'Failed to fetch flight data',
        timestamp: Date.now(),
        message: axios.isAxiosError(error) ? error.message : 'Unknown error'
      });
    }
  }

  // Update the private method to use the static one
  private processFlightData(rawData: any): ProcessedFlightData[] {
    return FlightDataService.processFlightData(rawData);
  }

  // Make this static too for testing
  public static getAircraftCategory(categoryCode: number): string {
    const categories: { [key: number]: string } = {
      0: 'Unknown',
      1: 'Light',
      2: 'Small',
      3: 'Large',
      4: 'High Vortex Large',
      5: 'Heavy',
      6: 'High Performance',
      7: 'Rotorcraft',
    };
    return categories[categoryCode] || 'Unknown';
  }

  private getOptimalBounds(): GeographicBounds | null {
    if (this.clientBounds.size === 0) {
      // Default to a reasonable worldwide area if no specific bounds
      return null;
    }

    // If only one client, use their bounds
    if (this.clientBounds.size === 1) {
      return Array.from(this.clientBounds.values())[0];
    }

    // Merge all client bounds to get optimal coverage
    const allBounds = Array.from(this.clientBounds.values());
    return {
      lamin: Math.min(...allBounds.map(b => b.lamin)),
      lomin: Math.min(...allBounds.map(b => b.lomin)),
      lamax: Math.max(...allBounds.map(b => b.lamax)),
      lomax: Math.max(...allBounds.map(b => b.lomax)),
    };
  }

  // Public method to get current statistics
  public getStatistics(): {
    connectedClients: number;
    lastUpdateTime: number | null;
    totalFlights: number;
    isPolling: boolean;
  } {
    return {
      connectedClients: this.connectedClients.size,
      lastUpdateTime: this.lastFlightData.length > 0 ? Date.now() : null,
      totalFlights: this.lastFlightData.length,
      isPolling: this.pollingInterval !== null,
    };
  }

  public static normalizeCallsign(callsign: string): string {
    return (callsign || '').trim().toUpperCase();
  }

  // Update the processFlightData method to use normalized callsigns
  public static processFlightData(rawData: any): ProcessedFlightData[] {
    if (!rawData || !rawData.states || !Array.isArray(rawData.states)) {
      return [];
    }

    return rawData.states
      .filter((state: any[]) => {
        // Filter out flights without position data
        return state[6] !== null && state[5] !== null; // longitude and latitude
      })
      .map((state: any[]): ProcessedFlightData => {
        return {
          icao24: state[0] || '',
          callsign: FlightDataService.normalizeCallsign(state[1] || 'Unknown'), // Normalize here
          originCountry: state[2] || 'Unknown',
          position: (state[6] !== null && state[5] !== null) ? {
            latitude: state[6],
            longitude: state[5],
            altitude: state[7] || 0, // baro_altitude
          } : null,
          velocity: {
            speed: state[9] || 0, // velocity
            heading: state[10] || 0, // true_track
            verticalRate: state[11] || 0, // vertical_rate
          },
          onGround: state[8] || false,
          lastUpdate: state[4] || Date.now() / 1000,
          category: FlightDataService.getAircraftCategory(state[17] || 0),
        };
      });
  }
}