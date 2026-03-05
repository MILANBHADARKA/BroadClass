/**
 * System Metrics Utility
 *
 * Provides CPU and memory usage for health reporting.
 * Works on both Linux (production) and Windows (dev).
 */
import os from 'os';

/**
 * Get CPU usage percentage over a 1-second sample.
 * @returns {Promise<number>} CPU usage 0–100
 */
export function getCpuUsage() {
  return new Promise((resolve) => {
    const start = os.cpus().map((cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      return { idle: cpu.times.idle, total };
    });

    setTimeout(() => {
      const end = os.cpus().map((cpu) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        return { idle: cpu.times.idle, total };
      });

      let idleDiff = 0;
      let totalDiff = 0;
      for (let i = 0; i < start.length; i++) {
        idleDiff += end[i].idle - start[i].idle;
        totalDiff += end[i].total - start[i].total;
      }

      const usage = totalDiff > 0 ? ((1 - idleDiff / totalDiff) * 100) : 0;
      resolve(Math.round(usage * 10) / 10);
    }, 1000);
  });
}

/**
 * Get memory usage percentage.
 * @returns {number} Memory usage 0–100
 */
export function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 1000) / 10;
}

/**
 * Get process-level memory usage in MB.
 * @returns {{ rss: number, heapUsed: number, heapTotal: number }}
 */
export function getProcessMemory() {
  const mem = process.memoryUsage();
  return {
    rss: Math.round(mem.rss / 1024 / 1024),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
  };
}
