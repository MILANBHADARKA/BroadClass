import validator from 'validator';
import xss from 'xss';

/**
 * Sanitization utilities for user input validation and XSS prevention
 */

/**
 * Sanitize string input - removes HTML/script tags and trims whitespace
 * @param {string} input - Raw user input
 * @param {number} maxLength - Maximum allowed length (optional)
 * @returns {string} Sanitized string
 */
export function sanitizeString(input, maxLength = 1000) {
  if (!input || typeof input !== 'string') return '';
  
  // Remove XSS attempts
  let sanitized = xss(input, {
    whiteList: {}, // Strip all HTML tags
    stripIgnoreTag: true,
  });
  
  // Trim and limit length
  sanitized = sanitized.trim();
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Validate and sanitize email address
 * @param {string} email - Raw email input
 * @returns {{valid: boolean, sanitized: string, error?: string}}
 */
export function sanitizeEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, sanitized: '', error: 'Email is required' };
  }
  
  const trimmed = email.trim().toLowerCase();
  
  if (!validator.isEmail(trimmed)) {
    return { valid: false, sanitized: trimmed, error: 'Invalid email format' };
  }
  
  // Normalize email
  const normalized = validator.normalizeEmail(trimmed, {
    gmail_remove_dots: false, // Keep dots in Gmail addresses
    gmail_remove_subaddress: false, // Keep +tags
  });
  
  return { valid: true, sanitized: normalized };
}

/**
 * Sanitize classroom/broadcast name - allows alphanumeric, spaces, and basic punctuation
 * @param {string} name - Raw name input
 * @returns {{valid: boolean, sanitized: string, error?: string}}
 */
export function sanitizeName(name, minLength = 2, maxLength = 100) {
  if (!name || typeof name !== 'string') {
    return { valid: false, sanitized: '', error: 'Name is required' };
  }
  
  const sanitized = sanitizeString(name, maxLength);
  
  if (sanitized.length < minLength) {
    return { 
      valid: false, 
      sanitized, 
      error: `Name must be at least ${minLength} characters` 
    };
  }
  
  if (sanitized.length > maxLength) {
    return { 
      valid: false, 
      sanitized: sanitized.substring(0, maxLength), 
      error: `Name must not exceed ${maxLength} characters` 
    };
  }
  
  return { valid: true, sanitized };
}

/**
 * Sanitize description/text content - allows more characters but still prevents XSS
 * @param {string} text - Raw text input
 * @param {number} maxLength - Maximum length (default 1000)
 * @returns {string}
 */
export function sanitizeText(text, maxLength = 1000) {
  if (!text || typeof text !== 'string') return '';
  
  // Allow basic formatting but strip dangerous tags
  const sanitized = xss(text, {
    whiteList: {
      p: [],
      br: [],
      strong: [],
      em: [],
      u: [],
      ul: [],
      ol: [],
      li: [],
    },
    stripIgnoreTag: true,
  });
  
  return sanitized.trim().substring(0, maxLength);
}

/**
 * Validate password strength
 * @param {string} password - Raw password
 * @returns {{valid: boolean, error?: string}}
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  
  if (password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters' };
  }
  
  if (password.length > 128) {
    return { valid: false, error: 'Password must not exceed 128 characters' };
  }
  
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  
  return { valid: true };
}

/**
 * Sanitize classroom code - alphanumeric only, uppercase
 * @param {string} code - Raw code
 * @returns {string}
 */
export function sanitizeClassroomCode(code) {
  if (!code || typeof code !== 'string') return '';
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Validate URL
 * @param {string} url - Raw URL
 * @returns {{valid: boolean, sanitized: string, error?: string}}
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, sanitized: '', error: 'URL is required' };
  }
  
  const trimmed = url.trim();
  
  if (!validator.isURL(trimmed, { protocols: ['http', 'https'], require_protocol: true })) {
    return { valid: false, sanitized: trimmed, error: 'Invalid URL format' };
  }
  
  return { valid: true, sanitized: trimmed };
}
