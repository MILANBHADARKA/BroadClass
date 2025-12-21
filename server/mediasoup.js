import * as mediasoup from 'mediasoup';
import { config } from './config.js';

let worker;
let router;

/**
 * Initialize mediasoup worker and router
 */
export async function initMediasoup() {
  try {
    // Create a Worker
    worker = await mediasoup.createWorker({
      logLevel: config.mediasoup.worker.logLevel,
      logTags: config.mediasoup.worker.logTags,
      rtcMinPort: config.mediasoup.worker.rtcMinPort,
      rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
    });

    console.log('[Mediasoup] Worker created, PID:', worker.pid);

    worker.on('died', () => {
      console.error('[Mediasoup] Worker died, exiting in 2 seconds...');
      setTimeout(() => process.exit(1), 2000);
    });

    // Create a Router
    const mediaCodecs = config.mediasoup.router.mediaCodecs;
    router = await worker.createRouter({ mediaCodecs });

    console.log('[Mediasoup] Router created');

    return { worker, router };
  } catch (error) {
    console.error('[Mediasoup] Initialization error:', error);
    throw error;
  }
}

/**
 * Get the current router instance
 */
export function getRouter() {
  return router;
}

/**
 * Get the current worker instance
 */
export function getWorker() {
  return worker;
}
