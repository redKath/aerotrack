import express from 'express';
import routes from './routes';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', routes);

// Global error handler (should be after routes)
app.use(errorHandler);

export default app;
