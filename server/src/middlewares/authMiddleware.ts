import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config/config';

// Extend Request interface
declare global {
  namespace Express {
    interface Request {
      openSkyToken?: string;
    }
  }
}

interface TokenData {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface OpenSkyCredentials {
  clientId: string;
  clientSecret: string;
}

class AuthManager {
  private static instance: AuthManager;
  private openSkyToken: CachedToken | null = null;
  private openSkyCredentials: OpenSkyCredentials | null = null;
  private refreshPromise: Promise<string> | null = null;
  private readonly EXPIRY_MARGIN = 60 * 1000; // 60 seconds in milliseconds
  private readonly TOKEN_URL = config.openSky.tokenUrl;

  private constructor() {
    this.loadOpenSkyCredentials();
  }

  public static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  private loadOpenSkyCredentials(): void {
    this.openSkyCredentials = {
	  clientId: config.openSky.clientId,
	  clientSecret: config.openSky.clientSecret,
	};
  }

  private async requestOpenSkyToken(): Promise<string> {
    if (!this.openSkyCredentials) {
      throw new Error('OpenSky credentials not available');
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', this.openSkyCredentials.clientId);
    params.append('client_secret', this.openSkyCredentials.clientSecret);

    try {
      const response = await axios.post<TokenData>(this.TOKEN_URL, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      });

      const { access_token, expires_in } = response.data;
      const expiresAt = Date.now() + (expires_in * 1000) - this.EXPIRY_MARGIN;

      this.openSkyToken = {
        token: access_token,
        expiresAt,
      };

      console.log(`OpenSky token acquired successfully, expires at: ${new Date(expiresAt).toISOString()}`);
      return access_token;
    } catch (error) {
      console.error('Failed to obtain OpenSky access token:', error);
      throw new Error('Failed to obtain OpenSky access token');
    }
  }

  public async getValidOpenSkyToken(): Promise<string> {
    // If we have a valid token, return it
    if (this.openSkyToken && Date.now() < this.openSkyToken.expiresAt) {
      return this.openSkyToken.token;
    }

    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start a new refresh
    this.refreshPromise = this.requestOpenSkyToken();

    try {
      const token = await this.refreshPromise;
      return token;
    } finally {
      this.refreshPromise = null;
    }
  }

  public clearOpenSkyToken(): void {
    this.openSkyToken = null;
  }

  public getOpenSkyTokenInfo(): {
    hasToken: boolean;
    isExpired: boolean;
    expiresAt?: Date;
    timeUntilExpiry?: number;
  } {
    if (!this.openSkyToken) {
      return { hasToken: false, isExpired: true };
    }

    const now = Date.now();
    const isExpired = now >= this.openSkyToken.expiresAt;
    const timeUntilExpiry = Math.max(0, this.openSkyToken.expiresAt - now);

    return {
      hasToken: true,
      isExpired,
      expiresAt: new Date(this.openSkyToken.expiresAt),
      timeUntilExpiry: Math.floor(timeUntilExpiry / 1000), // Convert to seconds
    };
  }
}

// OpenSky Authentication Middleware
export const openSkyAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authManager = AuthManager.getInstance();
    const token = await authManager.getValidOpenSkyToken();
    req.openSkyToken = token;
    next();
  } catch (error) {
    console.error('OpenSky authentication failed:', error);
    res.status(503).json({
      error: 'Authentication service unavailable',
      message: 'Failed to obtain OpenSky access token',
      timestamp: new Date().toISOString(),
    });
  }
};

// Helper function to create authorization headers
export const getOpenSkyAuthHeader = (token: string): { Authorization: string } => {
  return {
    Authorization: `Bearer ${token}`,
  };
};

// Health check function for OpenSky auth
export const getOpenSkyAuthHealth = (): {
  success: boolean;
  tokenStatus: ReturnType<AuthManager['getOpenSkyTokenInfo']>;
  timestamp: string;
} => {
  const authManager = AuthManager.getInstance();
  const tokenStatus = authManager.getOpenSkyTokenInfo();

  return {
    success: tokenStatus.hasToken && !tokenStatus.isExpired,
    tokenStatus,
    timestamp: new Date().toISOString(),
  };
};


export { AuthManager };
