/**
 * Logger utility
 * 
 * Provides context-prefixed logging. Swap for winston/pino in production.
 */

export function createLogger(prefix) {
  return {
    info: (...args) => console.log(`[${prefix}]`, ...args),
    warn: (...args) => console.warn(`[${prefix}]`, ...args),
    error: (...args) => console.error(`[${prefix}]`, ...args),
    debug: (...args) => {
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`[${prefix}:DEBUG]`, ...args);
      }
    },
  };
}
