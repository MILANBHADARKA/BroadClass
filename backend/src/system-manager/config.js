import dotenv from 'dotenv';
import { createLogger } from '../utils/logger.js';

dotenv.config();

const log = createLogger('config');

export const managerConfig = {
  // Server
  port: parseInt(process.env.MANAGER_PORT || process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Frontend CORS
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  
  // Database
  databaseUrl: process.env.DATABASE_URL,
  
  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // JWT Auth
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: '7d',
  
  // Internal API Key (for Origin → Manager communication)
  internalApiKey: process.env.INTERNAL_API_KEY || 'broadclass-internal-key-change-in-production',
  
  // Edge configuration
  defaultEdgeRegion: process.env.DEFAULT_EDGE_REGION || 'ap-south-1',
  
  // Recording (future)
  s3Bucket: process.env.S3_BUCKET || 'broadclass-recordings',
  s3Region: process.env.AWS_REGION || 'ap-south-1',
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Validate required env vars
function validateConfig() {
  const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'INTERNAL_API_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    log.warn(`Missing env vars (may fail at runtime): ${missing.join(', ')}`);
  }
}

validateConfig();

export default managerConfig;
