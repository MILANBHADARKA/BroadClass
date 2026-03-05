/**
 * Logger utility
 *
 * - Development: Colored, human-readable console output
 * - Production: Structured JSON logs (CloudWatch / ELK compatible)
 *
 * Swap for winston/pino if you need transports, rotation, etc.
 */

const IS_PROD = process.env.NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info;

function shouldLog(level) {
  return LEVELS[level] >= currentLevel;
}

function formatJson(level, prefix, args) {
  const message = args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      if (typeof a === 'object') return JSON.stringify(a);
      return String(a);
    })
    .join(' ');
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: prefix,
    message,
  });
}

export function createLogger(prefix) {
  if (IS_PROD) {
    // Structured JSON logging for production
    return {
      info: (...args) => {
        if (shouldLog('info')) console.log(formatJson('info', prefix, args));
      },
      warn: (...args) => {
        if (shouldLog('warn')) console.warn(formatJson('warn', prefix, args));
      },
      error: (...args) => {
        if (shouldLog('error')) console.error(formatJson('error', prefix, args));
      },
      debug: (...args) => {
        if (shouldLog('debug')) console.log(formatJson('debug', prefix, args));
      },
    };
  }

  // Development: human-readable colored output
  return {
    info: (...args) => {
      if (shouldLog('info')) console.log(`[${prefix}]`, ...args);
    },
    warn: (...args) => {
      if (shouldLog('warn')) console.warn(`[${prefix}]`, ...args);
    },
    error: (...args) => {
      if (shouldLog('error')) console.error(`[${prefix}]`, ...args);
    },
    debug: (...args) => {
      if (shouldLog('debug')) console.log(`[${prefix}:DEBUG]`, ...args);
    },
  };
}
