/**
 * Auth REST Routes
 *
 * POST /api/auth/register  – Create new user (teacher or student)
 * POST /api/auth/login     – Login with email + password
 * POST /api/auth/logout    – Clear auth cookie
 * GET  /api/auth/me        – Get current user profile + token (protected)
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../services/prisma.js';
import { signToken, verifyToken } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('auth:routes');
const router = Router();

const IS_PROD = process.env.NODE_ENV === 'production';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://localhost:5173';
const IS_LOCALHOST = FRONTEND_ORIGIN.includes('localhost') || FRONTEND_ORIGIN.includes('127.0.0.1');

/** Cookie options for the JWT HttpOnly cookie */
function cookieOptions() {
  return {
    httpOnly: true,                                   // JS cannot read this cookie
    secure: IS_PROD && !IS_LOCALHOST,                  // HTTPS only in real production (not localhost)
    sameSite: 'lax',                                   // lax works for same-site + top-level nav
    maxAge: 7 * 24 * 60 * 60 * 1000,                  // 7 days (matches JWT expiry)
    path: '/',
  };
}

// ── Register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const validRoles = ['TEACHER', 'STUDENT'];
    const userRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password & create user
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, role: userRole },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    // Set HttpOnly cookie + return token in body (for Socket.IO)
    res.cookie('token', token, cookieOptions());

    log.info(`User registered: ${user.email} (${user.role})`);
    res.status(201).json({ user, token });
  } catch (err) {
    log.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── Login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    // Set HttpOnly cookie + return token in body (for Socket.IO)
    res.cookie('token', token, cookieOptions());

    log.info(`User logged in: ${user.email} (${user.role})`);
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (err) {
    log.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Logout ────────────────────────────────────────────────────
router.post('/logout', (_req, res) => {
  res.clearCookie('token', { httpOnly: true, path: '/' });
  res.json({ message: 'Logged out' });
});

// ── Me (protected) ────────────────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Return a fresh token so frontend can use it for Socket.IO after page refresh
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.cookie('token', token, cookieOptions());

    res.json({ user, token });
  } catch (err) {
    log.error('Me error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export default router;
