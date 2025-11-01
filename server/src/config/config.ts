import dotenv from 'dotenv';

dotenv.config();

interface Config {
	port: number;
	nodeEnv: string;
	clientUrl: string;
	openSky: {
		tokenUrl: string;
		apiBaseUrl: string;
		clientId: string;
		clientSecret: string;
	};
}

const config: Config = {
	port: Number(process.env.PORT) || 3000,
	nodeEnv: process.env.NODE_ENV || 'development',
	clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
	openSky: {
		tokenUrl: process.env.OPENSKY_TOKEN_URL || 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
		apiBaseUrl: process.env.OPENSKY_API_URL || 'https://opensky-network.org/api',
		clientId: process.env.OPENSKY_CLIENT_ID || '',
		clientSecret: process.env.OPENSKY_CLIENT_SECRET || '',
	},
};

export default config;
