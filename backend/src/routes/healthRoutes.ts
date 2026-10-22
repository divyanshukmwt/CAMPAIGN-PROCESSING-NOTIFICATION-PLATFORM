import { Router, Request, Response, NextFunction } from 'express';
import { getDatabaseHealth } from '../config/database';
import { getReadyRedisClient, getRedisHealth } from '../config/redis';
import { getDeliveryQueue, getQueueHealthMetrics } from '../queues/campaignQueues';
import { getCacheMetrics } from '../services/cacheService';
import { getProviderMetrics } from '../services/mockProvider';
import { getActiveWorkersHealth } from '../worker';
import { readRateLimiter } from '../middleware/rateLimiter';

const router = Router();

/**
 * GET /api/health
 * Comprehensive system observability endpoint reporting MongoDB, Redis,
 * BullMQ queue counts, active worker heartbeats, cache hit rates, and provider metrics.
 */
router.get(
  '/',
  readRateLimiter,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [redisHealth, queueHealth, workersHealth] = await Promise.all([
        getRedisHealth(),
        getQueueHealthMetrics(),
        getActiveWorkersHealth(),
      ]);

      const dbHealth = getDatabaseHealth();
      const cacheMetrics = getCacheMetrics();
      const providerMetrics = getProviderMetrics();

      const overallStatus =
        dbHealth.connected && redisHealth.connected
          ? 'healthy'
          : dbHealth.connected || redisHealth.connected
            ? 'degraded'
            : 'starting';

      res.status(200).json({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: dbHealth,
        redis: redisHealth,
        queues: queueHealth,
        workers: workersHealth,
        cache: cacheMetrics,
        provider: providerMetrics,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/health/failed-jobs
 * Inspects permanently failed jobs in the BullMQ delivery-queue (Module 2 & Module 5).
 */
router.get(
  '/failed-jobs',
  readRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const redis = getReadyRedisClient();

      if (!redis) {
        res.status(200).json({
          available: false,
          jobs: [],
        });
        return;
      }

      const queue = getDeliveryQueue();
      const failedJobs = await queue.getFailed(0, limit - 1);

      const formatted = failedJobs.map((job) => ({
        jobId: String(job.id),
        name: job.name,
        data: job.data,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
        finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      }));

      res.status(200).json({
        available: true,
        count: formatted.length,
        jobs: formatted,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
