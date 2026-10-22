import { Queue, JobsOptions } from 'bullmq';
import { EventEmitter } from 'events';
import { env } from '../config/env';
import { createBullMQConnection, getReadyRedisClient } from '../config/redis';
import { CampaignStatus } from '../models/Campaign';
import { logger } from '../utils/logger';

export const CAMPAIGN_DISPATCH_QUEUE_NAME = 'campaign-dispatch';
export const DELIVERY_QUEUE_NAME = 'delivery-queue';
export const CAMPAIGN_EVENTS_CHANNEL = 'campaign:events';

export interface CampaignDispatchJobData {
  campaignId: string;
  tenantId: string;
  batchSize: number;
  triggeredBy: 'create' | 'schedule' | 'start' | 'resume' | 'retry';
}

export interface DeliveryJobData {
  deliveryId: string;
  campaignId: string;
  tenantId: string;
  recipient: string;
  maxAttempts: number;
  backoffDelayMs: number;
  manualRetryEpoch?: number;
}

export interface CampaignProgressEvent {
  type: 'campaign_updated' | 'delivery_updated' | 'campaign_completed';
  campaignId: string;
  tenantId: string;
  status?: CampaignStatus;
  timestamp: string;
}

let dispatchQueue: Queue<CampaignDispatchJobData> | null = null;
let deliveryQueue: Queue<DeliveryJobData> | null = null;

// In-memory fallback state for pause/cancel flags & test/offline environments
const memoryCampaignState = new Map<string, CampaignStatus>();
const memoryDispatchJobs = new Map<string, { jobId: string; data: CampaignDispatchJobData; delayMs: number }>();
const memoryDeliveryJobs = new Map<string, { jobId: string; data: DeliveryJobData; opts: JobsOptions }>();
export const localEventBus = new EventEmitter();
localEventBus.setMaxListeners(100);

export function getInMemoryQueueSnapshot() {
  return {
    dispatchJobs: Array.from(memoryDispatchJobs.values()),
    deliveryJobs: Array.from(memoryDeliveryJobs.values()),
  };
}

export function resetInMemoryQueues(): void {
  memoryCampaignState.clear();
  memoryDispatchJobs.clear();
  memoryDeliveryJobs.clear();
}

/**
 * Lazily initializes and returns the BullMQ Campaign Dispatch Queue.
 */
export function getCampaignDispatchQueue(): Queue<CampaignDispatchJobData> {
  if (!dispatchQueue) {
    dispatchQueue = new Queue<CampaignDispatchJobData>(CAMPAIGN_DISPATCH_QUEUE_NAME, {
      connection: createBullMQConnection('queue:campaign-dispatch'),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: { count: 500 },
        removeOnFail: false,
      },
    });
  }
  return dispatchQueue;
}

/**
 * Lazily initializes and returns the BullMQ Delivery Queue.
 * Note: removeOnFail is set to false so permanently failed jobs remain visible
 * in BullMQ for inspection alongside MongoDB delivery records (Module 2).
 */
export function getDeliveryQueue(): Queue<DeliveryJobData> {
  if (!deliveryQueue) {
    deliveryQueue = new Queue<DeliveryJobData>(DELIVERY_QUEUE_NAME, {
      connection: createBullMQConnection('queue:delivery-queue'),
      defaultJobOptions: {
        attempts: env.DELIVERY_MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: env.DELIVERY_BACKOFF_DELAY_MS,
        },
        removeOnComplete: { count: 2000, age: 3600 },
        removeOnFail: false,
      },
    });
  }
  return deliveryQueue;
}

/**
 * Builds BullMQ job options for an individual recipient delivery job
 * with exponential backoff and deterministic jobId to prevent duplicate queueing.
 */
export function buildDeliveryJobOptions(params: {
  deliveryId: string;
  maxAttempts?: number;
  backoffDelayMs?: number;
  manualRetryEpoch?: number;
}): JobsOptions {
  const maxAttempts = params.maxAttempts ?? env.DELIVERY_MAX_ATTEMPTS;
  const backoffDelayMs = params.backoffDelayMs ?? env.DELIVERY_BACKOFF_DELAY_MS;
  const jobId =
    params.manualRetryEpoch && params.manualRetryEpoch > 0
      ? `delivery_${params.deliveryId}_r${params.manualRetryEpoch}`
      : `delivery_${params.deliveryId}`;

  return {
    jobId,
    attempts: maxAttempts,
    backoff: {
      type: 'exponential',
      delay: backoffDelayMs,
    },
    removeOnComplete: { count: 2000, age: 3600 },
    removeOnFail: false,
  };
}

/**
 * Enqueues a campaign dispatch job (immediate or delayed for future scheduledAt).
 */
export async function enqueueCampaignDispatchJob(
  data: CampaignDispatchJobData,
  scheduledAt?: Date | null
): Promise<{ jobId: string; delayMs: number }> {
  const delayMs =
    scheduledAt && scheduledAt.getTime() > Date.now()
      ? Math.max(0, scheduledAt.getTime() - Date.now())
      : 0;

  const jobId =
    data.triggeredBy === 'resume' || data.triggeredBy === 'retry'
      ? `dispatch_${data.campaignId}_${data.triggeredBy}_${Date.now()}`
      : `dispatch_${data.campaignId}`;

  memoryDispatchJobs.set(jobId, { jobId, data, delayMs });

  const redis = getReadyRedisClient();
  if (redis) {
    const queue = getCampaignDispatchQueue();
    await queue.add('dispatch-campaign', data, {
      jobId,
      delay: delayMs,
    });
  }

  logger.info(
    {
      campaignId: data.campaignId,
      jobId,
      delayMs,
      triggeredBy: data.triggeredBy,
      redisBacked: Boolean(redis),
    },
    'Enqueued campaign dispatch job in BullMQ'
  );

  return { jobId, delayMs };
}

/**
 * Enqueues a batch of delivery jobs using BullMQ addBulk in controlled chunk sizes
 * so we never flood Redis with an uncontrolled workload (Module 2).
 */
export async function enqueueDeliveryBatch(
  jobs: DeliveryJobData[],
  chunkSize = env.CAMPAIGN_BATCH_SIZE
): Promise<number> {
  if (jobs.length === 0) return 0;

  const redis = getReadyRedisClient();
  const safeChunkSize = Math.max(1, chunkSize);
  let enqueuedCount = 0;

  for (let i = 0; i < jobs.length; i += safeChunkSize) {
    const slice = jobs.slice(i, i + safeChunkSize);
    const bulkPayload = slice.map((item) => {
      const opts = buildDeliveryJobOptions({
        deliveryId: item.deliveryId,
        maxAttempts: item.maxAttempts,
        backoffDelayMs: item.backoffDelayMs,
        manualRetryEpoch: item.manualRetryEpoch,
      });
      const jobId = String(opts.jobId);
      if (!memoryDeliveryJobs.has(jobId)) {
        memoryDeliveryJobs.set(jobId, { jobId, data: item, opts });
      }
      return {
        name: 'send-notification',
        data: item,
        opts,
      };
    });

    if (redis) {
      const queue = getDeliveryQueue();
      await queue.addBulk(bulkPayload);
    }
    enqueuedCount += slice.length;
  }

  return enqueuedCount;
}

/**
 * Fast campaign state coordination in Redis so workers immediately detect
 * paused or cancelled campaigns without waiting on heavy queries.
 */
function getCampaignStateRedisKey(campaignId: string): string {
  return `campaign:state:${campaignId}`;
}

export async function setCampaignRuntimeState(
  campaignId: string,
  status: CampaignStatus
): Promise<void> {
  memoryCampaignState.set(campaignId, status);
  try {
    const redis = getReadyRedisClient();
    if (redis) {
      await redis.set(getCampaignStateRedisKey(campaignId), status, 'EX', 86400);
    }
  } catch (err) {
    logger.warn({ err, campaignId, status }, 'Failed to write campaign state to Redis');
  }
}

export async function getCampaignRuntimeState(
  campaignId: string
): Promise<CampaignStatus | null> {
  try {
    const redis = getReadyRedisClient();
    if (redis) {
      const val = await redis.get(getCampaignStateRedisKey(campaignId));
      if (val) {
        return val as CampaignStatus;
      }
    }
  } catch {
    // Fallback to in-memory map
  }
  return memoryCampaignState.get(campaignId) ?? null;
}

/**
 * Publishes a real-time campaign event to both local EventEmitter and Redis Pub/Sub
 * so SSE clients connected to the API receive live progress updates from workers.
 */
export async function publishCampaignEvent(event: CampaignProgressEvent): Promise<void> {
  localEventBus.emit('campaign_event', event);
  try {
    const redis = getReadyRedisClient();
    if (redis) {
      await redis.publish(CAMPAIGN_EVENTS_CHANNEL, JSON.stringify(event));
    }
  } catch {
    // Non-fatal if Redis pub/sub is offline
  }
}

/**
 * Returns live BullMQ queue health metrics (Module 5).
 */
export async function getQueueHealthMetrics() {
  try {
    const redis = getReadyRedisClient();
    if (!redis) {
      return {
        available: false,
        dispatchQueue: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
        deliveryQueue: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
      };
    }

    const [dispatchCounts, deliveryCounts] = await Promise.all([
      getCampaignDispatchQueue().getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed'
      ),
      getDeliveryQueue().getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed'
      ),
    ]);

    return {
      available: true,
      dispatchQueue: dispatchCounts,
      deliveryQueue: deliveryCounts,
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch BullMQ queue health metrics');
    return {
      available: false,
      dispatchQueue: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
      deliveryQueue: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
    };
  }
}

export async function closeQueues(): Promise<void> {
  const promises: Promise<void>[] = [];
  if (dispatchQueue) {
    promises.push(dispatchQueue.close());
    dispatchQueue = null;
  }
  if (deliveryQueue) {
    promises.push(deliveryQueue.close());
    deliveryQueue = null;
  }
  await Promise.all(promises);
}
