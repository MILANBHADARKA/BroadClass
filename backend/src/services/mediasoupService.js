import mediasoup from 'mediasoup';
import { mediaCodecs } from '../config/mediaCodecs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('mediasoup');

/**
 * Create mediasoup workers and cache router capabilities.
 *
 * @param {object} opts
 * @param {number} opts.numWorkers - Number of workers to spawn
 * @param {string} opts.logLevel   - mediasoup log level
 * @param {number} opts.rtcMinPort - Lower bound of RTC UDP port range
 * @param {number} opts.rtcMaxPort - Upper bound of RTC UDP port range
 * @returns {{ workers: Array, rtpCapabilities: object }}
 */
export async function createWorkers({ numWorkers, logLevel, rtcMinPort, rtcMaxPort }) {
  log.info(`Initializing ${numWorkers} mediasoup worker(s)...`);

  const workers = [];

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel,
      rtcMinPort,
      rtcMaxPort,
    });

    worker.on('died', () => {
      log.error(`Worker ${i} died! PID: ${worker.pid}. Exiting.`);
      process.exit(1);
    });

    workers.push(worker);
    log.info(`  Worker ${i} created – PID: ${worker.pid}`);
  }

  // Cache RTP capabilities via a temporary router
  const tempRouter = await workers[0].createRouter({ mediaCodecs });
  const rtpCapabilities = tempRouter.rtpCapabilities;
  tempRouter.close();

  log.info('mediasoup initialization complete');

  return { workers, rtpCapabilities };
}

/**
 * Round-robin worker selector factory.
 *
 * @param {Array} workers
 * @returns {() => object} getNextWorker
 */
export function createWorkerPool(workers) {
  let idx = 0;
  return function getNextWorker() {
    const worker = workers[idx];
    idx = (idx + 1) % workers.length;
    return worker;
  };
}
