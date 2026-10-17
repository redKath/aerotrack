import type { DataStatus, FlightData } from './socketService';

// Anonymous, browser-side access to the OpenSky public API. Used as a fallback when
// the backend can't reach OpenSky (it blocks cloud hosting IPs). No credentials here:
// requests come from the visitor's own IP and count against their anonymous quota.
const OPENSKY_API_URL = 'https://opensky-network.org/api';
const REQUEST_TIMEOUT = 10000;

export interface Bounds {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

export class DirectFetchError extends Error {
  constructor(public readonly status: Exclude<DataStatus, 'ok' | 'pending'>) {
    super(`OpenSky direct fetch failed: ${status}`);
  }
}

const AIRCRAFT_CATEGORIES: { [key: number]: string } = {
  0: 'Unknown',
  1: 'Light',
  2: 'Small',
  3: 'Large',
  4: 'High Vortex Large',
  5: 'Heavy',
  6: 'High Performance',
  7: 'Rotorcraft',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Same mapping as the server's FlightDataService.processFlightData
const processStates = (states: unknown): FlightData[] => {
  if (!Array.isArray(states)) return [];
  return states
    .filter((state: any[]) => state[6] !== null && state[5] !== null)
    .map((state: any[]): FlightData => ({
      icao24: state[0] || '',
      callsign: (state[1] || 'Unknown').trim().toUpperCase(),
      originCountry: state[2] || 'Unknown',
      position: {
        latitude: state[6],
        longitude: state[5],
        altitude: state[7] || 0,
      },
      velocity: {
        speed: state[9] || 0,
        heading: state[10] || 0,
        verticalRate: state[11] || 0,
      },
      onGround: state[8] || false,
      lastUpdate: state[4] || Date.now() / 1000,
      category: AIRCRAFT_CATEGORIES[state[17] || 0] || 'Unknown',
    }));
};

export const fetchFlightsDirect = async (bounds: Bounds | null): Promise<FlightData[]> => {
  const params = new URLSearchParams();
  if (bounds) {
    params.append('lamin', clamp(bounds.lamin, -90, 90).toString());
    params.append('lomin', clamp(bounds.lomin, -180, 180).toString());
    params.append('lamax', clamp(bounds.lamax, -90, 90).toString());
    params.append('lomax', clamp(bounds.lomax, -180, 180).toString());
  }
  const url = `${OPENSKY_API_URL}/states/all${params.toString() ? `?${params.toString()}` : ''}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch {
    throw new DirectFetchError('upstream_unavailable');
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) throw new DirectFetchError('rate_limited');
  if (response.status === 401 || response.status === 403) throw new DirectFetchError('auth_failed');
  if (!response.ok) throw new DirectFetchError('upstream_unavailable');

  const data = await response.json();
  return processStates(data?.states);
};
