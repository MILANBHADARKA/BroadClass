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
  internalApiKey: process.env.INTERNAL_API_KEY || 'broadclass-internal-key-change-in-production',
  role: 'ORIGIN',

  // Auto-scaling (AWS only)
  autoScale: {
    enabled:            process.env.AUTO_SCALE_ENABLED === 'true',
    minEdges:           parseInt(process.env.AUTO_SCALE_MIN_EDGES)  || 2,
    maxEdges:           parseInt(process.env.AUTO_SCALE_MAX_EDGES)  || 10,
    scaleUpThreshold:   parseFloat(process.env.AUTO_SCALE_UP_THRESHOLD)   || 70,
    scaleDownThreshold: parseFloat(process.env.AUTO_SCALE_DOWN_THRESHOLD) || 20,
    checkInterval:      parseInt(process.env.AUTO_SCALE_CHECK_INTERVAL)   || 30_000,
    cooldownUp:         parseInt(process.env.AUTO_SCALE_COOLDOWN_UP)      || 60_000,
    cooldownDown:       parseInt(process.env.AUTO_SCALE_COOLDOWN_DOWN)    || 120_000,
    // AWS provider settings
    aws: {
      asgName: process.env.AWS_ASG_NAME  || 'broadclass-edge-asg',
      region:  process.env.AWS_REGION    || 'ap-south-1',
    },
  },
};
