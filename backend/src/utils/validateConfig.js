/**
 * Configuration Validation
 * Validates critical environment variables on startup to fail fast if misconfigured
 */

import { createLogger } from './logger.js';

const log = createLogger('config:validation');

/**
 * Validates configuration on startup - throws error if critical issues found
 * @throws {Error} If validation fails
 */
export function validateConfig() {
  const errors = [];
  const warnings = [];
  const isProd = process.env.NODE_ENV === 'production';

  // Critical validations for production
  if (isProd) {
    // JWT Secret validation
    const jwtSecret = process.env.JWT_SECRET || '';
    if (
      !jwtSecret ||
      jwtSecret.includes('dev-') ||
      jwtSecret.includes('change-in-production') ||
      jwtSecret.length < 32
    ) {
      errors.push(
        'JWT_SECRET must be changed in production and be at least 32 characters long'
      );
    }

    // Database URL validation
    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl) {
      errors.push('DATABASE_URL is required in production');
    } else if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
      errors.push('DATABASE_URL must be a valid PostgreSQL connection string');
    }

    // Internal API Key validation
    const internalKey = process.env.INTERNAL_API_KEY || '';
    if (
      !internalKey ||
      internalKey.includes('dev-') ||
      internalKey.includes('change-in-production') ||
      internalKey.length < 32
    ) {
      errors.push(
        'INTERNAL_API_KEY must be changed in production and be at least 32 characters long'
      );
    }

    // Redis authentication validation (check URL has password or REDIS_PASSWORD is set)
    const redisUrl = process.env.REDIS_URL || '';
    const hasPasswordInUrl = redisUrl.includes(':') && redisUrl.includes('@');
    const redisPassword = process.env.REDIS_PASSWORD || '';
    if (!hasPasswordInUrl && (!redisPassword || redisPassword === 'dev-redis-pass')) {
      warnings.push(
        'Redis should have authentication: use REDIS_URL with password (rediss://default:PASS@host) or set REDIS_PASSWORD'
      );
    }

    // Frontend origin validation
    const frontendOrigin = process.env.FRONTEND_ORIGIN || '';
    if (
      !frontendOrigin ||
      frontendOrigin.includes('localhost') ||
      frontendOrigin.includes('127.0.0.1')
    ) {
      warnings.push(
        'FRONTEND_ORIGIN should be set to your production domain in production'
      );
    }

    // HTTPS validation (if not behind proxy)
    if (!process.env.BEHIND_PROXY && !frontendOrigin.startsWith('https://')) {
      warnings.push(
        'FRONTEND_ORIGIN should use HTTPS in production (unless behind a proxy)'
      );
    }
  }

  // General validations (all environments)

  // Port validation
  const port = parseInt(process.env.PORT || '3000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a valid port number (1-65535)');
  }

  // RTC ports validation
  const rtcMinPort = parseInt(process.env.RTC_MIN_PORT || '40000', 10);
  const rtcMaxPort = parseInt(process.env.RTC_MAX_PORT || '49999', 10);
  if (isNaN(rtcMinPort) || isNaN(rtcMaxPort) || rtcMinPort >= rtcMaxPort) {
    errors.push('RTC_MIN_PORT must be less than RTC_MAX_PORT');
  }
  // Port count is inclusive: 50000-50099 = 100 ports
  const portCount = rtcMaxPort - rtcMinPort + 1;
  if (portCount < 100) {
    warnings.push(
      `RTC port range is small (${portCount} ports), may limit concurrent broadcasts`
    );
  }

  // Log level validation
  const logLevel = process.env.LOG_LEVEL || 'info';
  const validLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(logLevel)) {
    warnings.push(
      `LOG_LEVEL '${logLevel}' is invalid. Valid options: ${validLevels.join(', ')}`
    );
  }

  // Auto-scaling validation (if enabled)
  if (process.env.AUTO_SCALE_ENABLED === 'true') {
    const minEdges = parseInt(process.env.AUTO_SCALE_MIN_EDGES || '2', 10);
    const maxEdges = parseInt(process.env.AUTO_SCALE_MAX_EDGES || '10', 10);
    if (isNaN(minEdges) || isNaN(maxEdges) || minEdges >= maxEdges) {
      errors.push('AUTO_SCALE_MIN_EDGES must be less than AUTO_SCALE_MAX_EDGES');
    }
    if (maxEdges > 50) {
      warnings.push(
        'AUTO_SCALE_MAX_EDGES is very high (>50), ensure infrastructure can support this'
      );
    }

    // AWS provider specific validation
    const provider = process.env.AUTO_SCALE_PROVIDER || 'docker';
    if (provider === 'aws') {
      if (!process.env.AWS_ASG_NAME) {
        errors.push('AWS_ASG_NAME is required when using AWS auto-scaling provider');
      }
      if (!process.env.AWS_REGION) {
        warnings.push('AWS_REGION not set, will use default region');
      }
    }
  }

  // Redis URL validation
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
      errors.push('REDIS_URL must start with redis:// or rediss:// (TLS)');
    }
    if (isProd && redisUrl.startsWith('redis://') && !redisUrl.includes('localhost')) {
      warnings.push(
        'REDIS_URL in production should use rediss:// (TLS) for security'
      );
    }
  }

  // Report results
  if (warnings.length > 0) {
    log.warn('Configuration warnings:');
    warnings.forEach((warning) => log.warn(`  ⚠️  ${warning}`));
  }

  if (errors.length > 0) {
    log.error('Configuration validation FAILED:');
    errors.forEach((error) => log.error(`  ❌ ${error}`));
    throw new Error(
      `Configuration validation failed with ${errors.length} error(s). See logs above.`
    );
  }

  log.info(`✅ Configuration validation passed (${warnings.length} warnings)`);
}

/**
 * Get summary of current configuration (safe to log - no secrets)
 */
export function getConfigSummary() {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || '3000',
    logLevel: process.env.LOG_LEVEL || 'info',
    hasDatabase: !!process.env.DATABASE_URL,
    hasRedis: !!process.env.REDIS_URL,
    redisTls: (process.env.REDIS_URL || '').startsWith('rediss://'),
    autoScaleEnabled: process.env.AUTO_SCALE_ENABLED === 'true',
    autoScaleProvider: process.env.AUTO_SCALE_PROVIDER || 'docker',
    rtcPortRange: `${process.env.RTC_MIN_PORT || '40000'}-${process.env.RTC_MAX_PORT || '49999'}`,
  };
}
