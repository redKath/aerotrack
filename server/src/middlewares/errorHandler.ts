import { Request, Response, NextFunction } from 'express';
import { toSafeError } from '../utils/upstreamError';

export interface AppError extends Error {
  status?: number;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Unhandled request error:', toSafeError(err));
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
  });
};