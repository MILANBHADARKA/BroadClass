import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

export const originConfig = {
  port: parseInt(process.env.PORT) || 3001,
  announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
  rtcMinPort: parseInt(process.env.RTC_MIN_PORT) || 40000,
  rtcMaxPort: parseInt(process.env.RTC_MAX_PORT) || 49999,
  numWorkers: parseInt(process.env.NUM_WORKERS) || os.cpus().length,
  logLevel: process.env.LOG_LEVEL || 'warn',
  enableSimulcast: process.env.ENABLE_SIMULCAST === 'true',
  maxBroadcasters: parseInt(process.env.MAX_BROADCASTERS) || 10,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  role: 'ORIGIN',
};
