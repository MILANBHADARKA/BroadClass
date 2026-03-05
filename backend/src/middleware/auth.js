/**
 * JWT Authentication Middleware
 *
 * - verifyToken     – Express middleware for REST routes
 * - verifyRole      – Express middleware for role-based checks
 * - socketAuthMiddleware – Socket.IO middleware (checks token in handshake)
 * - signToken       – helper to create JWT
 */
import jwt from 'jsonwebtoken';
import { createLogger } from '../utils/logger.js';

const log = createLogger('auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-broadcast-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Create Token 
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

//  Verify & Decode 
export function decodeToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

//  Express Middleware: Verify Token 
// Reads JWT from HttpOnly cookie first, falls back to Authorization header
export function verifyToken(req, res, next) {
  let token = req.cookies?.token; // HttpOnly cookie (preferred)

  if (!token) {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      token = header.split(' ')[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = decodeToken(token); // { id, email, role, iat, exp }
    next();
  } catch (err) {
    log.warn('Invalid token:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Express Middleware: Require Role 
export function verifyRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires one of: ${allowedRoles.join(', ')}` });
    }
    next();
  };
}

// ─ Socket.IO Middleware: Verify Token 
// Reads from handshake auth.token first, then falls back to cookie
export function socketAuthMiddleware(socket, next) {
  let token = socket.handshake.auth?.token;

  // Fallback: parse cookie from handshake headers
  if (!token && socket.handshake.headers?.cookie) {
    const match = socket.handshake.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    return next(new Error('Authentication token required'));
  }

  try {
    socket.user = decodeToken(token);
    next();
  } catch (err) {
    log.warn(`Socket auth failed for ${socket.id}:`, err.message);
    return next(new Error('Invalid or expired token'));
  }
}
