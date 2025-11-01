import axios from 'axios';

const BASE_URL = 'http://localhost:3000/api/opensky';

describe('OpenSky API Integration Tests', () => {
  beforeAll(async () => {
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await axios.get(`${BASE_URL}/health`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success');
      expect(response.data).toHaveProperty('tokenStatus');
      expect(response.data).toHaveProperty('timestamp');
    });
  });

  describe('Aircraft States', () => {
    it('should fetch all aircraft states', async () => {
      const response = await axios.get(`${BASE_URL}/states`);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('time');
      expect(response.data).toHaveProperty('states');
      expect(Array.isArray(response.data.states)).toBe(true);
    }, 30000); // 30 second timeout

    it('should fetch aircraft states with bounds', async () => {
      const params = {
        lamin: 45.8389,
        lomin: 5.9962,
        lamax: 47.8229,
        lomax: 10.5226
      };
      
      const response = await axios.get(`${BASE_URL}/states`, { params });
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('states');
    }, 30000);
  });

});