import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import routes from './routes';
import { errorHandler } from './middlewares/errorHandler';
import { FlightDataService } from './services/flightDataService';
import config from './config/config';
const app = express();
const httpServer = createServer(app);

// Configure Socket.IO with CORS
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.clientUrl,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: config.clientUrl,
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api', routes);

// Error handling middleware
app.use(errorHandler);

// Initialize Flight Data Service
const flightDataService = new FlightDataService(io);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Start flight data streaming when first client connects
  flightDataService.handleClientConnection(socket);
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    flightDataService.handleClientDisconnection(socket);
  });

  // Handle geographic area updates
  socket.on('updateBounds', (bounds) => {
    console.log(`Client ${socket.id} updated bounds:`, bounds);
    flightDataService.updateClientBounds(socket.id, bounds);
  });
});

export { app, httpServer, io };