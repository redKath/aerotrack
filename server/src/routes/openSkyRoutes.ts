import { Router } from 'express';
import { openSkyAuth, getOpenSkyAuthHealth } from '../middlewares/authMiddleware';
import { getOpenSkyStates } from '../controllers/openSkyController';

const router = Router();

// Health check endpoint (no auth required)
router.get('/health', (req, res) => {
  const healthData = getOpenSkyAuthHealth();
  res.json(healthData);
});

// Apply OpenSky authentication to all subsequent routes
router.use(openSkyAuth);

// Protected OpenSky API routes
router.get('/states', getOpenSkyStates);

export default router;