import { createLogger } from '../utils/logger.js';

const log = createLogger('ai:client');

const BASE_URL = process.env.AI_SERVICE_INTERNAL_URL || 'http://ai-service:8080';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

const MODERATION_TIMEOUT_MS = 4000;       // moderation should be <1s
const ANSWER_TIMEOUT_MS = 8000;           // RAG: embed + pgvector + Groq round-trip
const BREAKER_FAILURE_THRESHOLD = 5;
const BREAKER_WINDOW_MS = 30_000;
const BREAKER_OPEN_MS = 60_000;

// In-memory breaker. One instance per process is fine.
const _failures = [];
let _breakerOpenUntil = 0;

function _recordFailure() {
  const now = Date.now();
  _failures.push(now);
  // Trim outside the rolling window.
  while (_failures.length && now - _failures[0] > BREAKER_WINDOW_MS) {
    _failures.shift();
  }
  if (_failures.length >= BREAKER_FAILURE_THRESHOLD) {
    _breakerOpenUntil = now + BREAKER_OPEN_MS;
    log.warn(
      `Circuit breaker OPEN for ${BREAKER_OPEN_MS / 1000}s after ${_failures.length} failures`,
    );
    _failures.length = 0;
  }
}

function _isBreakerOpen() {
  return Date.now() < _breakerOpenUntil;
}

/**
 * POST JSON to the ai-service with internal-API-key auth and a timeout.
 * Returns parsed JSON on success, throws on any failure. The caller is
 * expected to swallow non-critical errors (moderation = best-effort,
 * answer = falls through to teacher queue).
 */
async function _post(path, body, { timeoutMs }) {
  if (_isBreakerOpen()) {
    throw new Error('ai-service circuit breaker open');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': INTERNAL_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      _recordFailure();
      throw new Error(`ai-service ${path} returned ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      _recordFailure();
      throw new Error(`ai-service ${path} timed out`);
    }
    if (!_isBreakerOpen()) _recordFailure();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort moderation. Returns:
 *   { allowed: true,  flags: [] }  → safe to publish
 *   { allowed: false, flags: [...] } → hide as HIDDEN_BY_MODERATION
 *   null                          → ai-service unavailable; caller treats as allow
 */
export async function moderateMessage(content) {
  try {
    return await _post('/moderate', { content }, { timeoutMs: MODERATION_TIMEOUT_MS });
  } catch (err) {
    log.debug(`moderateMessage failed: ${err.message}`);
    return null;
  }
}

/**
 * Best-effort RAG. Returns the ai-service /answer response shape, or null
 * on any failure (circuit breaker, timeout, 5xx, transcript unavailable).
 * Callers treat null as "fall through to teacher queue".
 *
 * Returns:
 *   { answerable: bool, answer: string|null, citations: [...], confidence: 'high'|'low', gate: {...} }
 *   or null on failure / breaker open.
 */
export async function answerQuestion({ broadcastId, content }) {
  try {
    return await _post(
      '/answer',
      { broadcastId, content },
      { timeoutMs: ANSWER_TIMEOUT_MS },
    );
  } catch (err) {
    log.debug(`answerQuestion failed: ${err.message}`);
    return null;
  }
}
