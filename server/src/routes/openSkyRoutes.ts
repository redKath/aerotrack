import { Router } from 'express';
import { openSkyAuth, getOpenSkyAuthHealth } from '../middlewares/authMiddleware';
import { getOpenSkyStates, getOpenSkyFlightsByAircraft, getProcessedFlights } from '../controllers/openSkyController';

const router = Router();

// Health check endpoint (no auth required)
router.get('/health', (req, res) => {
  const healthData = getOpenSkyAuthHealth();
  res.json(healthData);
});

// Apply OpenSky authentication to all subsequent routes
router.use(openSkyAuth);

// REST API endpoints for testing
router.get('/states', getOpenSkyStates);
router.get('/flights/aircraft', getOpenSkyFlightsByAircraft);

//returns processed data like the real-time service
router.get('/flights', getProcessedFlights);

export default router;