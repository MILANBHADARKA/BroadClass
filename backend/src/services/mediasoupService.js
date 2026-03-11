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

  // mediasoup only accepts: 'debug' | 'warn' | 'error' | 'none'
  const MEDIASOUP_LEVELS = { debug: 'debug', info: 'warn', warn: 'warn', error: 'error', none: 'none' };
  const msLogLevel = MEDIASOUP_LEVELS[logLevel] || 'warn';
  const workerOptions = { logLevel: msLogLevel, rtcMinPort, rtcMaxPort };

  const workers = [];

  // Spawns a worker and attaches a self-healing 'died' handler that replaces
  // the slot in the shared array instead of crashing the process.
  async function spawnWorker(slotIndex) {
    const worker = await mediasoup.createWorker(workerOptions);
    worker.on('died', () => {
      log.error(`Worker at slot ${slotIndex} died (PID ${worker.pid}) — spawning replacement`);
      spawnWorker(slotIndex)
        .then((replacement) => {
          workers[slotIndex] = replacement;
          log.info(`Replacement worker at slot ${slotIndex} ready (PID ${replacement.pid})`);
        })
        .catch((err) => {
          log.error(`Failed to replace worker at slot ${slotIndex}: ${err.message}`);
        });
    });
    return worker;
  }

  for (let i = 0; i < numWorkers; i++) {
    const worker = await spawnWorker(i);
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
 * Load-aware worker selector factory.
 * Returns the worker with the fewest active routers on each call,
 * distributing load evenly instead of blind round-robin.
 *
 * @param {Array} workers
 * @returns {() => object} getNextWorker
 */
export function createWorkerPool(workers) {
  const routerCount = new Map();

  return function getNextWorker() {
    let minLoad = Infinity;
    let best = workers[0];
    for (const w of workers) {
      const count = routerCount.get(w.pid) ?? 0;
      if (count < minLoad) {
        minLoad = count;
        best = w;
      }
    }
    routerCount.set(best.pid, (routerCount.get(best.pid) ?? 0) + 1);
    return best;
  };
}
