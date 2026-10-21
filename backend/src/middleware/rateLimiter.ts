import { Request, Response, NextFunction, RequestHandler } from 'express';
import { env } from '../config/env';
import { getReadyRedisClient } from '../config/redis';
import { resolveTenantId } from '../services/cacheService';
import { logger } from '../utils/logger';

export interface RateLimiterOptions {
  keyPrefix: string;
  windowSeconds: number;
  maxRequests: number;
}

interface MemoryRateBucket {
  count: number;
  resetAtMs: number;
}

const memoryBuckets = new Map<string, MemoryRateBucket>();

/**
 * Atomic Redis Lua script for distributed rate limiting:
 * Increments the counter, sets expiration on first request, and returns [currentCount, pttlMs].
 */
const RATE_LIMIT_LUA_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local pttl = redis.call("PTTL", KEYS[1])
if pttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  pttl = tonumber(ARGV[1])
end
return { current, pttl }
`;

async function evaluateRateLimit(
  bucketKey: string,
  windowSeconds: number
): Promise<{ count: number; ttlMs: number }> {
  const windowMs = windowSeconds * 1000;

  try {
    const redis = getReadyRedisClient();
    if (redis) {
      const res = (await redis.eval(
        RATE_LIMIT_LUA_SCRIPT,
        1,
        bucketKey,
        String(windowMs)
      )) as [number, number];
      if (Array.isArray(res) && res.length === 2) {
        return {
          count: Number(res[0]),
          ttlMs: Math.max(Number(res[1]), 100),
        };
      }
    }
  } catch (err) {
    logger.warn({ err, bucketKey }, 'Redis rate limiter fallback to memory');
  }

  // Fallback in-memory bucket
  const now = Date.now();
  const existing = memoryBuckets.get(bucketKey);
  if (!existing || now >= existing.resetAtMs) {
    const resetAtMs = now + windowMs;
    memoryBuckets.set(bucketKey, { count: 1, resetAtMs });
    return { count: 1, ttlMs: windowMs };
  }

  existing.count += 1;
  return {
    count: existing.count,
    ttlMs: Math.max(existing.resetAtMs - now, 100),
  };
}

/**
 * Creates an Express rate-limiting middleware backed by Redis so limits are shared
 * across all API instances (Module 4B).
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenantId = resolveTenantId(req);
    const clientIp = (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown-ip'
    ).replace(/[^a-zA-Z0-9.:_-]/g, '_');

    const bucketKey = `ratelimit:${options.keyPrefix}:${tenantId}:${clientIp}`;

    const { count, ttlMs } = await evaluateRateLimit(bucketKey, options.windowSeconds);
    const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const remaining = Math.max(0, options.maxRequests - count);
    const resetEpochSeconds = Math.ceil((Date.now() + ttlMs) / 1000);

    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetEpochSeconds));

    if (count > options.maxRequests) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'TOO_MANY_REQUESTS',
        message: `Rate limit of ${options.maxRequests} requests per ${options.windowSeconds}s exceeded. Please retry after ${retryAfterSeconds}s.`,
        retryAfterSeconds,
        limit: options.maxRequests,
        windowSeconds: options.windowSeconds,
      });
      return;
    }

    next();
  };
}

export const writeRateLimiter = createRateLimiter({
  keyPrefix: 'write',
  windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
  maxRequests: env.RATE_LIMIT_WRITE_MAX,
});

export const readRateLimiter = createRateLimiter({
  keyPrefix: 'read',
  windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
  maxRequests: env.RATE_LIMIT_READ_MAX,
});

export function resetRateLimiterForTesting(): void {
  memoryBuckets.clear();
}
