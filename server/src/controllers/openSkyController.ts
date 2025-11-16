import { Request, Response } from 'express';
import axios from 'axios';
import { getOpenSkyAuthHeader } from '../middlewares/authMiddleware';
import config from '../config/config';

const OPENSKY_API_URL = config.openSky.apiBaseUrl;

export const getOpenSkyStates = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.openSkyToken) {
      res.status(401).json({ error: 'No authentication token available' });
      return;
    }

    const { lamin, lomin, lamax, lomax } = req.query;
    
    const params = new URLSearchParams();
    if (lamin) params.append('lamin', lamin as string);
    if (lomin) params.append('lomin', lomin as string);
    if (lamax) params.append('lamax', lamax as string);
    if (lomax) params.append('lomax', lomax as string);

    const url = `${OPENSKY_API_URL}/states/all${params.toString() ? `?${params.toString()}` : ''}`;
    
    const response = await axios.get(url, {
      headers: getOpenSkyAuthHeader(req.openSkyToken),
      timeout: 30000,
    });

    res.json({
      success: true,
      data: response.data,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error fetching OpenSky states:', error);
    res.status(500).json({ 
      error: 'Failed to fetch aircraft states',
      message: axios.isAxiosError(error) ? error.message : 'Unknown error'
    });
  }
};

export const getOpenSkyFlightsByAircraft = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.openSkyToken) {
      res.status(401).json({ error: 'No authentication token available' });
      return;
    }

    const { icao24, begin, end } = req.query;

    if (!icao24) {
      res.status(400).json({ error: 'icao24 parameter is required' });
      return;
    }

    const params = new URLSearchParams();
    params.append('icao24', icao24 as string);
    if (begin) params.append('begin', begin as string);
    if (end) params.append('end', end as string);

    const url = `${OPENSKY_API_URL}/flights/aircraft?${params.toString()}`;
    
    const response = await axios.get(url, {
      headers: getOpenSkyAuthHeader(req.openSkyToken),
      timeout: 30000,
    });

    res.json({
      success: true,
      data: response.data,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error fetching OpenSky flights:', error);
    res.status(500).json({ 
      error: 'Failed to fetch flight data',
      message: axios.isAxiosError(error) ? error.message : 'Unknown error'
    });
  }
};

// New endpoint specifically for testing - returns processed data like the real-time service
export const getProcessedFlights = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.openSkyToken) {
      res.status(401).json({ error: 'No authentication token available' });
      return;
    }

    const { lamin, lomin, lamax, lomax } = req.query;
    
    const params = new URLSearchParams();
    if (lamin) params.append('lamin', lamin as string);
    if (lomin) params.append('lomin', lomin as string);
    if (lamax) params.append('lamax', lamax as string);
    if (lomax) params.append('lomax', lomax as string);

    const url = `${OPENSKY_API_URL}/states/all${params.toString() ? `?${params.toString()}` : ''}`;
    
    const response = await axios.get(url, {
      headers: getOpenSkyAuthHeader(req.openSkyToken),
      timeout: 30000,
    });

    // Process the data similar to the real-time service
    const processedFlights = processFlightData(response.data);

    res.json({
      success: true,
      flights: processedFlights,
      totalFlights: processedFlights.length,
      timestamp: Date.now(),
      bounds: { lamin, lomin, lamax, lomax }
    });
  } catch (error) {
    console.error('Error fetching processed flights:', error);
    res.status(500).json({ 
      error: 'Failed to fetch flight data',
      message: axios.isAxiosError(error) ? error.message : 'Unknown error'
    });
  }
};

function processFlightData(rawData: any): any[] {
  if (!rawData || !rawData.states || !Array.isArray(rawData.states)) {
    return [];
  }

  return rawData.states
    .filter((state: any[]) => {
      return state[6] !== null && state[5] !== null; // longitude and latitude
    })
    .map((state: any[]) => {
      return {
        icao24: state[0] || '',
        callsign: (state[1] || '').trim().toUpperCase() || 'Unknown', // Normalize to uppercase and trim
        originCountry: state[2] || 'Unknown',
        position: (state[6] !== null && state[5] !== null) ? {
          latitude: state[6],
          longitude: state[5],
          altitude: state[7] || 0,
        } : null,
        velocity: {
          speed: state[9] || 0,
          heading: state[10] || 0,
          verticalRate: state[11] || 0,
        },
        onGround: state[8] || false,
        lastUpdate: state[4] || Date.now() / 1000,
        category: getAircraftCategory(state[17] || 0),
      };
    });
}

function getAircraftCategory(categoryCode: number): string {
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