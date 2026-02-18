import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

export const edgeConfig = {
  port: parseInt(process.env.PORT) || 3002,
  externalPort: parseInt(process.env.EXTERNAL_PORT) || 3002,
  internalHost: process.env.INTERNAL_HOST || 'localhost',
  serverId: process.env.SERVER_ID || `EDGE-${Math.random().toString(36).substr(2, 9)}`,
  announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
  originIp: process.env.ORIGIN_IP || 'localhost',
  originPort: parseInt(process.env.ORIGIN_PORT) || 3001,
  rtcMinPort: parseInt(process.env.RTC_MIN_PORT) || 50000,
  rtcMaxPort: parseInt(process.env.RTC_MAX_PORT) || 50999,
  numWorkers: parseInt(process.env.NUM_WORKERS) || Math.min(2, os.cpus().length),
  logLevel: process.env.LOG_LEVEL || 'warn',
  maxCapacity: parseInt(process.env.MAX_CAPACITY) || 200,
  healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 10000,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  region: process.env.REGION || 'UNKNOWN',
  role: 'EDGE',
};
