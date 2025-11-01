import { FlightDataService } from '../src/services/flightDataService';
import { Server as SocketIOServer, Socket } from 'socket.io';
import axios from 'axios';
// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock config
jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    openSky: {
      apiBaseUrl: 'https://opensky-network.org/api'
    }
  }
}));

// Mock the auth middleware completely
jest.mock('../src/middlewares/authMiddleware', () => {
  const mockAuthManagerInstance = {
    getValidOpenSkyToken: jest.fn().mockResolvedValue('mock-token'),
    clearOpenSkyToken: jest.fn(),
  };

  return {
    AuthManager: {
      getInstance: jest.fn(() => mockAuthManagerInstance),
    },
    getOpenSkyAuthHeader: jest.fn(() => ({ Authorization: 'Bearer mock-token' })),
  };
});

// Import the mocked module
import { AuthManager, getOpenSkyAuthHeader } from '../src/middlewares/authMiddleware';

describe('FlightDataService', () => {
  let mockIo: jest.Mocked<SocketIOServer>;
  let mockSocket: jest.Mocked<Socket>;
  let mockSocket2: jest.Mocked<Socket>;
  let flightDataService: FlightDataService;

  const createMockSocket = (id: string): jest.Mocked<Socket> => ({
    id,
    emit: jest.fn(),
    on: jest.fn(),
    disconnect: jest.fn(),
    handshake: {
      address: '127.0.0.1',
      time: new Date().toISOString(),
      headers: {},
      query: {},
      auth: {},
      secure: false,
      issued: Date.now(),
      url: '/',
      xdomain: false,
    },
    rooms: new Set(),
    data: {},
    client: {} as any,
    request: {} as any,
    conn: {} as any,
    adapter: {} as any,
    server: {} as any,
    nsp: {} as any,
  } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Mock Socket.IO server
    mockIo = {
      emit: jest.fn(),
      on: jest.fn(),
    } as any;

    // Create mock sockets
    mockSocket = createMockSocket('test-socket-id');
    mockSocket2 = createMockSocket('test-socket-id-2');

    flightDataService = new FlightDataService(mockIo);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Client Connection Management', () => {
    it('should start polling when first client connects', () => {
      flightDataService.handleClientConnection(mockSocket);
      
      const stats = flightDataService.getStatistics();
      expect(stats.connectedClients).toBe(1);
      expect(stats.isPolling).toBe(true);
    });

    it('should stop polling when all clients disconnect', () => {
      flightDataService.handleClientConnection(mockSocket);
      flightDataService.handleClientDisconnection(mockSocket);
      
      const stats = flightDataService.getStatistics();
      expect(stats.connectedClients).toBe(0);
      expect(stats.isPolling).toBe(false);
    });

    it('should handle multiple client connections', () => {
      flightDataService.handleClientConnection(mockSocket);
      flightDataService.handleClientConnection(mockSocket2);
      
      const stats = flightDataService.getStatistics();
      expect(stats.connectedClients).toBe(2);
      expect(stats.isPolling).toBe(true);

      // Disconnect one client - should still be polling
      flightDataService.handleClientDisconnection(mockSocket);
      const statsAfterOne = flightDataService.getStatistics();
      expect(statsAfterOne.connectedClients).toBe(1);
      expect(statsAfterOne.isPolling).toBe(true);

      // Disconnect last client - should stop polling
      flightDataService.handleClientDisconnection(mockSocket2);
      const statsAfterAll = flightDataService.getStatistics();
      expect(statsAfterAll.connectedClients).toBe(0);
      expect(statsAfterAll.isPolling).toBe(false);
    });

    it('should send cached flight data to new clients immediately', () => {
      // Set some cached data
      const mockFlightData = [
        {
          icao24: '3c6444',
          callsign: 'SWR8T',
          originCountry: 'Switzerland',
          position: { latitude: 47.4502, longitude: 8.5456, altitude: 10972.8 },
          velocity: { speed: 250.5, heading: 180.0, verticalRate: -5.2 },
          onGround: false,
          lastUpdate: 1699000000,
          category: 'Light'
        }
      ];

      // Simulate having cached data
      (flightDataService as any).lastFlightData = mockFlightData;

      flightDataService.handleClientConnection(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('flightUpdate', {
        flights: mockFlightData,
        timestamp: expect.any(Number),
        totalFlights: 1
      });
    });
  });

  describe('Geographic Bounds Management', () => {
    it('should update client bounds and trigger data fetch', () => {
      const bounds = {
        lamin: 45.0,
        lomin: 5.0,
        lamax: 47.0,
        lomax: 10.0
      };

      flightDataService.handleClientConnection(mockSocket);
      flightDataService.updateClientBounds(mockSocket.id, bounds);

      // Should have triggered the auth calls
      expect(AuthManager.getInstance).toHaveBeenCalled();
    });

    it('should merge bounds from multiple clients', () => {
      const bounds1 = { lamin: 45.0, lomin: 5.0, lamax: 47.0, lomax: 10.0 };
      const bounds2 = { lamin: 40.0, lomin: 0.0, lamax: 50.0, lomax: 15.0 };

      flightDataService.handleClientConnection(mockSocket);
      flightDataService.handleClientConnection(mockSocket2);
      
      flightDataService.updateClientBounds(mockSocket.id, bounds1);
      flightDataService.updateClientBounds(mockSocket2.id, bounds2);

      // The optimal bounds should be the merged bounds
      // We can't directly test the private method, but we can verify it doesn't throw
      expect(() => {
        flightDataService.updateClientBounds(mockSocket.id, bounds1);
      }).not.toThrow();
    });
  });

  describe('Data Fetching and Broadcasting', () => {
    beforeEach(() => {
      // Mock successful API response
      mockedAxios.get.mockResolvedValue({
        data: {
          time: 1699000000,
          states: [
            [
              '3c6444', // icao24
              'SWR8T  ', // callsign
              'Switzerland', // origin_country
              1699000000, // time_position
              1699000000, // last_contact
              8.5456, // longitude
              47.4502, // latitude
              10972.8, // baro_altitude
              false, // on_ground
              250.5, // velocity
              180.0, // true_track
              -5.2, // vertical_rate
              null, // sensors
              11000.0, // geo_altitude
              null, // squawk
              false, // spi
              0, // position_source
              1 // category
            ]
          ]
        }
      });
    });

    it('should fetch and broadcast flight data when polling starts', async () => {
      flightDataService.handleClientConnection(mockSocket);

      // Fast forward to trigger polling
      await jest.advanceTimersByTimeAsync(1000);

      expect(AuthManager.getInstance).toHaveBeenCalled();
      expect(getOpenSkyAuthHeader).toHaveBeenCalledWith('mock-token');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('https://opensky-network.org/api/states/all'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock-token' },
          timeout: 30000
        })
      );
    });

    

    it('should stop polling when all clients disconnect', async () => {
      flightDataService.handleClientConnection(mockSocket);
      
      // Fast forward to ensure polling starts
      await jest.advanceTimersByTimeAsync(1000);
      expect(AuthManager.getInstance).toHaveBeenCalledTimes(1);

      // Disconnect client
      flightDataService.handleClientDisconnection(mockSocket);

      // Fast forward more time
      await jest.advanceTimersByTimeAsync(30000);

      // Should not have made additional API calls
      expect(AuthManager.getInstance).toHaveBeenCalledTimes(1);
    });
  });

  describe('Statistics', () => {
    it('should return correct initial statistics', () => {
      const stats = flightDataService.getStatistics();
      expect(stats).toEqual({
        connectedClients: 0,
        lastUpdateTime: null,
        totalFlights: 0,
        isPolling: false
      });
    });

    it('should return correct statistics after client connection', () => {
      flightDataService.handleClientConnection(mockSocket);
      
      const stats = flightDataService.getStatistics();
      expect(stats.connectedClients).toBe(1);
      expect(stats.isPolling).toBe(true);
      expect(stats.totalFlights).toBe(0);
      expect(stats.lastUpdateTime).toBeNull();
    });

    it('should update statistics after data is received', () => {
      // Set some mock flight data
      (flightDataService as any).lastFlightData = [
        { icao24: '3c6444', callsign: 'SWR8T' }
      ];

      const stats = flightDataService.getStatistics();
      expect(stats.totalFlights).toBe(1);
      expect(stats.lastUpdateTime).toEqual(expect.any(Number));
    });
  });

  describe('Data Processing - Static Methods', () => {
    describe('processFlightData', () => {
      it('should process valid flight data correctly', () => {
        const rawData = {
          time: 1699000000,
          states: [
            [
              '3c6444',      // icao24
              'SWR8T  ',     // callsign
              'Switzerland', // origin_country
              1699000000,    // time_position
              1699000000,    // last_contact
              8.5456,        // longitude
              47.4502,       // latitude
              10972.8,       // baro_altitude
              false,         // on_ground
              250.5,         // velocity
              180.0,         // true_track
              -5.2,          // vertical_rate
              null,          // sensors
              11000.0,       // geo_altitude
              null,          // squawk
              false,         // spi
              0,             // position_source
              1              // category
            ]
          ]
        };

        const result = FlightDataService.processFlightData(rawData);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          icao24: '3c6444',
          callsign: 'SWR8T',
          originCountry: 'Switzerland',
          position: {
            latitude: 47.4502,
            longitude: 8.5456,
            altitude: 10972.8
          },
          velocity: {
            speed: 250.5,
            heading: 180.0,
            verticalRate: -5.2
          },
          onGround: false,
          lastUpdate: 1699000000,
          category: 'Light'
        });
      });

      it('should filter out flights without position data', () => {
        const rawData = {
          time: 1699000000,
          states: [
            // Valid flight
            ['3c6444', 'SWR8T', 'Switzerland', 1699000000, 1699000000, 8.5456, 47.4502, 10972.8, false, 250.5, 180.0, -5.2, null, 11000.0, null, false, 0, 1],
            // Missing longitude
            ['abc123', 'TEST1', 'Unknown', 1699000000, 1699000000, null, 47.4502, 10972.8, false, 250.5, 180.0, -5.2, null, 11000.0, null, false, 0, 1],
            // Missing latitude
            ['def456', 'TEST2', 'Unknown', 1699000000, 1699000000, 8.5456, null, 10972.8, false, 250.5, 180.0, -5.2, null, 11000.0, null, false, 0, 1]
          ]
        };

        const result = FlightDataService.processFlightData(rawData);

        expect(result).toHaveLength(1);
        expect(result[0].icao24).toBe('3c6444');
      });

      it('should handle empty or invalid data', () => {
        expect(FlightDataService.processFlightData(null)).toEqual([]);
        expect(FlightDataService.processFlightData({})).toEqual([]);
        expect(FlightDataService.processFlightData({ states: null })).toEqual([]);
        expect(FlightDataService.processFlightData({ states: [] })).toEqual([]);
      });

      it('should handle missing or null values gracefully', () => {
        const rawData = {
          time: 1699000000,
          states: [
            [
              null,          // icao24
              null,          // callsign
              null,          // origin_country
              null,          // time_position
              null,          // last_contact
              8.5456,        // longitude
              47.4502,       // latitude
              null,          // baro_altitude
              null,          // on_ground
              null,          // velocity
              null,          // true_track
              null,          // vertical_rate
              null,          // sensors
              null,          // geo_altitude
              null,          // squawk
              null,          // spi
              null,          // position_source
              null           // category
            ]
          ]
        };

        const result = FlightDataService.processFlightData(rawData);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          icao24: '',
          callsign: 'Unknown',
          originCountry: 'Unknown',
          position: {
            latitude: 47.4502,
            longitude: 8.5456,
            altitude: 0
          },
          velocity: {
            speed: 0,
            heading: 0,
            verticalRate: 0
          },
          onGround: false,
          lastUpdate: expect.any(Number),
          category: 'Unknown'
        });
      });

      it('should trim whitespace from callsigns', () => {
        const rawData = {
          time: 1699000000,
          states: [
            ['3c6444', '  SWR8T  ', 'Switzerland', 1699000000, 1699000000, 8.5456, 47.4502, 10972.8, false, 250.5, 180.0, -5.2, null, 11000.0, null, false, 0, 1]
          ]
        };

        const result = FlightDataService.processFlightData(rawData);
        expect(result[0].callsign).toBe('SWR8T');
      });
    });

    describe('getAircraftCategory', () => {
      it('should return correct categories for known codes', () => {
        expect(FlightDataService.getAircraftCategory(0)).toBe('Unknown');
        expect(FlightDataService.getAircraftCategory(1)).toBe('Light');
        expect(FlightDataService.getAircraftCategory(2)).toBe('Small');
        expect(FlightDataService.getAircraftCategory(3)).toBe('Large');
        expect(FlightDataService.getAircraftCategory(4)).toBe('High Vortex Large');
        expect(FlightDataService.getAircraftCategory(5)).toBe('Heavy');
        expect(FlightDataService.getAircraftCategory(6)).toBe('High Performance');
        expect(FlightDataService.getAircraftCategory(7)).toBe('Rotorcraft');
      });

      it('should return "Unknown" for invalid category codes', () => {
        expect(FlightDataService.getAircraftCategory(99)).toBe('Unknown');
        expect(FlightDataService.getAircraftCategory(-1)).toBe('Unknown');
      });
    });
  });

});