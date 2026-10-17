import axios from 'axios';

// Status reported to clients and /health. 'pending' means no fetch has completed yet.
export type DataStatus = 'ok' | 'upstream_unavailable' | 'auth_failed' | 'rate_limited' | 'pending';

export interface SafeError {
  code?: string;
  status?: number;
  message: string;
}

// Error carrying only safe metadata about an upstream failure. Never holds the
// original axios error, whose config contains request bodies (client secret).
export class UpstreamError extends Error {
  public readonly code?: string;
  public readonly status?: number;
  public readonly retryAfterSec?: number;

  constructor(message: string, info: { code?: string; status?: number; retryAfterSec?: number } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.code = info.code;
    this.status = info.status;
    this.retryAfterSec = info.retryAfterSec;
  }

  static from(err: unknown, message: string): UpstreamError {
    const { code, status } = toSafeError(err);
    return new UpstreamError(message, { code, status, retryAfterSec: getRetryAfterSec(err) });
  }
}

// Reduce any error to fields that are safe to log. Never log raw axios errors:
// err.config.data / err.request contain credentials.
export const toSafeError = (err: unknown): SafeError => {
  if (err instanceof UpstreamError) {
    return { code: err.code, status: err.status, message: err.message };
  }
  if (axios.isAxiosError(err)) {
    return { code: err.code, status: err.response?.status, message: err.message };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: 'Non-error value thrown' };
};

export const classifyUpstreamError = (err: unknown): Exclude<DataStatus, 'ok' | 'pending'> => {
  const { status } = toSafeError(err);
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 429) return 'rate_limited';
  // Timeouts, connection errors (ECONNABORTED, ETIMEDOUT, ECONNRESET, ENOTFOUND), 5xx and anything else
  return 'upstream_unavailable';
};

export const getRetryAfterSec = (err: unknown): number | undefined => {
  if (err instanceof UpstreamError) return err.retryAfterSec;
  if (!axios.isAxiosError(err)) return undefined;
  const header = err.response?.headers?.['retry-after'] ?? err.response?.headers?.['x-rate-limit-retry-after-seconds'];
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
};
