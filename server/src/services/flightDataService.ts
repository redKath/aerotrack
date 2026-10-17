import { Server as SocketIOServer, Socket } from 'socket.io';
import axios from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuthManager, getOpenSkyAuthHeader } from '../middlewares/authMiddleware';
import config from '../config/config';
import {
  DataStatus,
  classifyUpstreamError,
  getRetryAfterSec,
  toSafeError,
} from '../utils/upstreamError';

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

interface FlightSnapshot {
  flights: ProcessedFlightData[];
  fetchedAt: number;
  bounds: GeographicBounds | null;
  fromDisk: boolean;
}

// Payload broadcast on 'flightUpdate'
export interface FlightStatePayload {
  status: DataStatus;
  flights: ProcessedFlightData[];
  lastUpdated: string | null;
  stale: boolean;
  nextRetryInSec?: number;
  bounds?: GeographicBounds | null;
}

export class FlightDataService {
  private io: SocketIOServer;
  private pollTimer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private isFetching = false;
  private connectedClients: Set<string> = new Set();
  private clientBounds: Map<string, GeographicBounds> = new Map();
  private snapshot: FlightSnapshot | null = null;
  private status: DataStatus = 'pending';
  private consecutiveFailures = 0;
  private retryAfterSec: number | undefined;
  private nextPollAt: number | null = null;
  private lastAttemptAt: number | null = null;
  private lastSnapshotWriteAt = 0;
  private readonly POLLING_INTERVAL = 15000; // 15 seconds
  private readonly MAX_BACKOFF = 5 * 60 * 1000; // 5 minutes
  private readonly REQUEST_TIMEOUT = 10000;
  private readonly SNAPSHOT_WRITE_INTERVAL = 60 * 1000;
  private readonly SNAPSHOT_FILE = process.env.SNAPSHOT_FILE || path.join(os.tmpdir(), 'aerotrack-last-snapshot.json');
  private readonly OPENSKY_API_URL = config.openSky.apiBaseUrl;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.loadSnapshotFromDisk();
  }

  public handleClientConnection(socket: Socket): void {
    this.connectedClients.add(socket.id);

    // Send current state immediately, even if there is no data yet
    socket.emit('flightUpdate', this.getStatePayload());

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
    // Fetch immediately for the new bounds, unless we are backing off after failures
    if (this.isPolling && this.consecutiveFailures === 0) {
      this.poll();
    }
  }

  private startPolling(): void {
    if (this.isPolling) {
      return; // Already polling
    }

    console.log('Starting flight data polling...');
    this.isPolling = true;
    this.poll();
  }

  private stopPolling(): void {
    if (!this.isPolling) {
      return;
    }
    console.log('Stopping flight data polling...');
    this.isPolling = false;
    this.clearPollTimer();
  }

  private clearPollTimer(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.nextPollAt = null;
  }

  // Fetch once, then schedule the next poll (normal interval, or backoff after failures)
  private async poll(): Promise<void> {
    if (this.isFetching) {
      return; // The in-flight poll will schedule the next one
    }
    this.clearPollTimer();
    this.isFetching = true;
    try {
      await this.fetchFlightData();
    } finally {
      this.isFetching = false;
    }

    if (this.isPolling) {
      const delay = this.getNextDelay();
      this.nextPollAt = Date.now() + delay;
      this.pollTimer = setTimeout(() => this.poll(), delay);
      if (this.consecutiveFailures > 0) {
        console.warn(`OpenSky unavailable (${this.status}), failure #${this.consecutiveFailures}, retrying in ${Math.round(delay / 1000)}s`);
      }
    }

    this.broadcastState();
  }

  // 15s -> 30s -> 60s -> 120s -> ... capped at 5 minutes; honours Retry-After on 429
  private getNextDelay(): number {
    if (this.consecutiveFailures === 0) {
      return this.POLLING_INTERVAL;
    }
    const backoff = Math.min(this.POLLING_INTERVAL * 2 ** (this.consecutiveFailures - 1), this.MAX_BACKOFF);
    const retryAfter = this.retryAfterSec ? Math.min(this.retryAfterSec * 1000, this.MAX_BACKOFF) : 0;
    return Math.max(backoff, retryAfter);
  }

  private async fetchFlightData(): Promise<void> {
    this.lastAttemptAt = Date.now();
    const authManager = AuthManager.getInstance();
    try {
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
        timeout: this.REQUEST_TIMEOUT,
      });

      const processedData = this.processFlightData(response?.data);
      this.snapshot = { flights: processedData, fetchedAt: Date.now(), bounds, fromDisk: false };

      if (this.consecutiveFailures > 0) {
        console.log(`OpenSky recovered after ${this.consecutiveFailures} failed attempts, resuming normal polling`);
      }
      this.status = 'ok';
      this.consecutiveFailures = 0;
      this.retryAfterSec = undefined;
      this.saveSnapshotToDisk();

      console.log(`Broadcasting flight data: ${processedData.length} flights to ${this.connectedClients.size} clients`);
    } catch (error) {
      const status = classifyUpstreamError(error);
      if (status === 'auth_failed') {
        // Token may have been revoked; request a fresh one next time
        authManager.clearOpenSkyToken();
      }
      this.status = status;
      this.consecutiveFailures++;
      this.retryAfterSec = getRetryAfterSec(error);
      console.error('Error fetching flight data:', { ...toSafeError(error), dataStatus: status });
    }
  }

  private broadcastState(): void {
    this.io.emit('flightUpdate', this.getStatePayload());
  }

  public getStatePayload(): FlightStatePayload {
    const snapshot = this.snapshot;
    const payload: FlightStatePayload = {
      status: this.status,
      flights: snapshot?.flights ?? [],
      lastUpdated: snapshot ? new Date(snapshot.fetchedAt).toISOString() : null,
      stale: snapshot ? this.status !== 'ok' || snapshot.fromDisk : false,
      bounds: snapshot?.bounds ?? null,
    };
    if (this.consecutiveFailures > 0 && this.nextPollAt) {
      payload.nextRetryInSec = Math.max(0, Math.round((this.nextPollAt - Date.now()) / 1000));
    }
    return payload;
  }

  public getHealth(): { server: 'ok'; opensky: DataStatus; lastSuccess: string | null; lastAttempt: string | null; nextRetryInSec?: number } {
    const lastSuccess = this.snapshot && !this.snapshot.fromDisk ? new Date(this.snapshot.fetchedAt).toISOString() : null;
    return {
      server: 'ok',
      opensky: this.status,
      lastSuccess,
      lastAttempt: this.lastAttemptAt ? new Date(this.lastAttemptAt).toISOString() : null,
      nextRetryInSec: this.getStatePayload().nextRetryInSec,
    };
  }

  // Persist one snapshot (throttled) so a restart during an outage still has something to show
  private saveSnapshotToDisk(): void {
    if (!this.snapshot || Date.now() - this.lastSnapshotWriteAt < this.SNAPSHOT_WRITE_INTERVAL) {
      return;
    }
    this.lastSnapshotWriteAt = Date.now();
    const { flights, fetchedAt, bounds } = this.snapshot;
    fs.promises
      .writeFile(this.SNAPSHOT_FILE, JSON.stringify({ flights, fetchedAt, bounds }))
      .catch((error) => console.warn('Could not persist flight snapshot:', toSafeError(error)));
  }

  private loadSnapshotFromDisk(): void {
    try {
      if (!fs.existsSync(this.SNAPSHOT_FILE)) {
        return;
      }
      const data = JSON.parse(fs.readFileSync(this.SNAPSHOT_FILE, 'utf8'));
      if (Array.isArray(data.flights) && typeof data.fetchedAt === 'number') {
        this.snapshot = { flights: data.flights, fetchedAt: data.fetchedAt, bounds: data.bounds ?? null, fromDisk: true };
        console.log(`Loaded stale flight snapshot from ${new Date(data.fetchedAt).toISOString()} (${data.flights.length} flights)`);
      }
    } catch (error) {
      console.warn('Could not load flight snapshot:', toSafeError(error));
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
      lastUpdateTime: this.snapshot?.fetchedAt ?? null,
      totalFlights: this.snapshot?.flights.length ?? 0,
      isPolling: this.isPolling,
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