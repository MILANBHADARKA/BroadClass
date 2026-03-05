import rateLimit from 'express-rate-limit';
import { createLogger } from '../utils/logger.js';

const log = createLogger('rate-limiter');

/**
 * Rate limiter for authentication endpoints to prevent brute-force attacks
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  message: { error: 'Too many attempts, please try again after 15 minutes' },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    log.warn(`Rate limit exceeded for IP ${req.ip} on ${req.path}`);
    res.status(429).json({
      error: 'Too many attempts, please try again after 15 minutes',
      requestId: req.id
    });
  },
  skip: (req) => {
    // Skip rate limiting in development mode
    return process.env.NODE_ENV === 'development' && process.env.DISABLE_RATE_LIMIT === 'true';
  }
});

/**
 * Stricter rate limiter for registration to prevent spam
 */
export const registrationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // 100 registrations per hour per IP
  message: { error: 'Too many registration attempts, please try again after 1 hour' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    log.warn(`Registration rate limit exceeded for IP ${req.ip}`);
    res.status(429).json({
      error: 'Too many registration attempts, please try again after 1 hour',
      requestId: req.id
    });
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'development' && process.env.DISABLE_RATE_LIMIT === 'true';
  }
});

/**
 * General API rate limiter
 */
export const apiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    log.warn(`API rate limit exceeded for IP ${req.ip} on ${req.path}`);
    res.status(429).json({
      error: 'Too many requests, please slow down',
      requestId: req.id
    });
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'development' && process.env.DISABLE_RATE_LIMIT === 'true';
  }
});
