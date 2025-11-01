import { Router } from 'express';
import openSkyRoutes from './openSkyRoutes';

const router = Router();

// Health check for the API
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'AeroTrack API',
  });
});

// Route handlers
router.use('/opensky', openSkyRoutes);

export default router;