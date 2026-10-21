import crypto from 'crypto';
import { Request } from 'express';
import { env } from '../config/env';
import { getReadyRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

interface MemoryCacheEntry {
  value: string;
  expiresAt: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();
const memoryTenantVersions = new Map<string, number>();

let cacheHits = 0;
let cacheMisses = 0;
let cacheInvalidations = 0;

/**
 * Extracts tenantId from X-Tenant-ID or X-User-ID header to prevent
 * serving cached results across different tenants or users (Module 4A).
 */
export function resolveTenantId(req?: Request | string): string {
  if (typeof req === 'string' && req.trim()) {
    return req.trim().toLowerCase();
  }
  if (req && typeof req === 'object' && 'headers' in req) {
    const rawHeader = req.headers['x-tenant-id'] || req.headers['x-user-id'];
    const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (value && typeof value === 'string' && value.trim()) {
      return value.trim().toLowerCase();
    }
  }
  return env.DEFAULT_TENANT_ID;
}

function getTenantVersionKey(tenantId: string): string {
  return `cache:v1:tenant:${tenantId}:version`;
}

/**
 * Returns the current cache version number for a tenant.
 */
export async function getTenantCacheVersion(tenantId: string): Promise<number> {
  const safeTenant = tenantId.trim().toLowerCase() || env.DEFAULT_TENANT_ID;
  try {
    const redis = getReadyRedisClient();
    if (redis) {
      const raw = await redis.get(getTenantVersionKey(safeTenant));
      if (raw) {
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed)) {
          memoryTenantVersions.set(safeTenant, parsed);
          return parsed;
        }
      } else {
        await redis.set(getTenantVersionKey(safeTenant), '1', 'NX');
      }
    }
  } catch (err) {
    logger.warn({ err, tenantId: safeTenant }, 'Redis cache version read fallback to memory');
  }

  return memoryTenantVersions.get(safeTenant) ?? 1;
}

/**
 * Builds deterministic, tenant-isolated, versioned cache keys.
 */
export async function buildCampaignListCacheKey(
  tenantId: string,
  queryParams: Record<string, unknown>
): Promise<string> {
  const version = await getTenantCacheVersion(tenantId);
  const canonical = JSON.stringify(
    Object.keys(queryParams)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = queryParams[key];
        return acc;
      }, {})
  );
  const queryHash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return `cache:v1:tenant:${tenantId}:v${version}:campaigns:list:${queryHash}`;
}

export async function buildCampaignSummaryCacheKey(tenantId: string): Promise<string> {
  const version = await getTenantCacheVersion(tenantId);
  return `cache:v1:tenant:${tenantId}:v${version}:campaigns:summary`;
}

export async function buildCampaignDetailCacheKey(
  tenantId: string,
  campaignId: string
): Promise<string> {
  const version = await getTenantCacheVersion(tenantId);
  return `cache:v1:tenant:${tenantId}:v${version}:campaign:${campaignId}`;
}

/**
 * Reads a JSON value from Redis cache (with in-memory fallback).
 */
export async function getCachedJson<T>(key: string): Promise<T | null> {
  try {
    const redis = getReadyRedisClient();
    if (redis) {
      const raw = await redis.get(key);
      if (raw) {
        cacheHits++;
        return JSON.parse(raw) as T;
      }
    }
  } catch (err) {
    logger.warn({ err, key }, 'Redis cache read error');
  }

  const mem = memoryCache.get(key);
  if (mem) {
    if (Date.now() < mem.expiresAt) {
      cacheHits++;
      return JSON.parse(mem.value) as T;
    }
    memoryCache.delete(key);
  }

  cacheMisses++;
  return null;
}

/**
 * Writes a JSON value to Redis cache with explicit TTL in seconds.
 */
export async function setCachedJson<T>(
  key: string,
  data: T,
  ttlSeconds: number
): Promise<void> {
  const serialized = JSON.stringify(data);
  memoryCache.set(key, {
    value: serialized,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  try {
    const redis = getReadyRedisClient();
    if (redis) {
      await redis.set(key, serialized, 'EX', ttlSeconds);
    }
  } catch (err) {
    logger.warn({ err, key }, 'Redis cache write error');
  }
}

/**
 * Atomically invalidates all cached campaign lists, summaries, and details for a tenant
 * in O(1) time by incrementing the tenant cache version counter.
 */
export async function invalidateTenantCampaignCache(
  tenantId: string,
  campaignId?: string
): Promise<number> {
  const safeTenant = tenantId.trim().toLowerCase() || env.DEFAULT_TENANT_ID;
  cacheInvalidations++;

  const nextMemVersion = (memoryTenantVersions.get(safeTenant) ?? 1) + 1;
  memoryTenantVersions.set(safeTenant, nextMemVersion);

  try {
    const redis = getReadyRedisClient();
    if (redis) {
      const newVersion = await redis.incr(getTenantVersionKey(safeTenant));
      memoryTenantVersions.set(safeTenant, newVersion);
      logger.debug(
        { tenantId: safeTenant, campaignId, newVersion },
        'Invalidated tenant campaign cache via version bump'
      );
      return newVersion;
    }
  } catch (err) {
    logger.warn({ err, tenantId: safeTenant }, 'Redis cache invalidation error');
  }

  return nextMemVersion;
}

export function getCacheMetrics() {
  return {
    hits: cacheHits,
    misses: cacheMisses,
    invalidations: cacheInvalidations,
    hitRate:
      cacheHits + cacheMisses > 0
        ? Number((cacheHits / (cacheHits + cacheMisses)).toFixed(4))
        : 0,
  };
}

export function resetCacheForTesting(): void {
  memoryCache.clear();
  memoryTenantVersions.clear();
  cacheHits = 0;
  cacheMisses = 0;
  cacheInvalidations = 0;
}
