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

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching OpenSky states:', error);
    res.status(500).json({ 
      error: 'Failed to fetch aircraft states',
      message: axios.isAxiosError(error) ? error.message : 'Unknown error'
    });
  }
};
