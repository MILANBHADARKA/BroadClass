/**
 * Recording Janitor
 *
 * Periodically scans for recordings stuck in PROCESSING and marks them FAILED.
 * Failure mode this guards against: Origin server crashes (or loses Redis)
 * after the DB transitions a recording to PROCESSING but before publishing
 * the final READY status. Without this, the recording is permanently stuck.
 */

import prisma from '../services/prisma.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('recording-janitor');

const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // PROCESSING > 15 min ⇒ assume dead

export function startRecordingJanitor() {
  const sweep = async () => {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    try {
      const result = await prisma.recording.updateMany({
        where: {
          status: 'PROCESSING',
          updatedAt: { lt: cutoff },
        },
        data: { status: 'FAILED' },
      });
      if (result.count > 0) {
        log.warn(`Marked ${result.count} stuck PROCESSING recording(s) as FAILED (older than ${STALE_THRESHOLD_MS / 60000} min)`);
      }
    } catch (err) {
      log.error('Recording janitor sweep failed:', err.message);
    }
  };

  // First sweep on startup, then on interval.
  sweep();
  const handle = setInterval(sweep, SCAN_INTERVAL_MS);
  log.info(`Recording janitor running every ${SCAN_INTERVAL_MS / 60000} min (stale threshold ${STALE_THRESHOLD_MS / 60000} min)`);

  return {
    stop: () => clearInterval(handle),
  };
}
