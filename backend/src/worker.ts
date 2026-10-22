import crypto from 'crypto';
import { Worker, Job } from 'bullmq';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import {
  closeAllRedisConnections,
  createBullMQConnection,
  getReadyRedisClient,
  getRedisClient,
} from './config/redis';
import {
  CAMPAIGN_DISPATCH_QUEUE_NAME,
  CampaignDispatchJobData,
  closeQueues,
  DELIVERY_QUEUE_NAME,
  DeliveryJobData,
} from './queues/campaignQueues';
import {
  processCampaignDispatch,
  processDeliveryJob,
} from './services/deliveryProcessor';
import { createContextLogger, logger } from './utils/logger';

export interface WorkerRuntimeInstance {
  workerId: string;
  dispatchWorker: Worker<CampaignDispatchJobData>;
  deliveryWorker: Worker<DeliveryJobData>;
  stop: () => Promise<void>;
}

const activeLocalWorkers = new Map<
  string,
  {
    workerId: string;
    concurrency: number;
    startedAt: string;
    lastHeartbeatAt: string;
    processedJobs: number;
    failedJobs: number;
  }
>();

function getWorkerHeartbeatRedisKey(workerId: string): string {
  return `worker:heartbeat:${workerId}`;
}

/**
 * Starts the BullMQ Campaign Dispatch Worker and Delivery Worker with configurable concurrency,
 * Redis heartbeat reporting, and graceful shutdown support (Modules 2 & 5).
 */
export function startWorkers(customConcurrency?: number): WorkerRuntimeInstance {
  const workerId = `worker_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  const concurrency = customConcurrency ?? env.WORKER_CONCURRENCY;
  const workerLog = createContextLogger({ workerId });

  const workerState = {
    workerId,
    concurrency,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    processedJobs: 0,
    failedJobs: 0,
  };
  activeLocalWorkers.set(workerId, workerState);

  // 1. Campaign Orchestrator / Batch Dispatcher Worker
  const dispatchWorker = new Worker<CampaignDispatchJobData>(
    CAMPAIGN_DISPATCH_QUEUE_NAME,
    async (job: Job<CampaignDispatchJobData>) => {
      return processCampaignDispatch(job.data, String(job.id));
    },
    {
      connection: createBullMQConnection(`worker:dispatch:${workerId}`),
      concurrency: 2,
    }
  );

  // 2. Notification Delivery Worker (Configurable Concurrency)
  const deliveryWorker = new Worker<DeliveryJobData>(
    DELIVERY_QUEUE_NAME,
    async (job: Job<DeliveryJobData>) => {
      const attemptNumber = (job.attemptsMade || 0) + 1;
      return processDeliveryJob(job.data, String(job.id), attemptNumber);
    },
    {
      connection: createBullMQConnection(`worker:delivery:${workerId}`),
      concurrency,
      stalledInterval: 10000,
      maxStalledCount: 2,
    }
  );

  deliveryWorker.on('completed', (job) => {
    workerState.processedJobs += 1;
    workerState.lastHeartbeatAt = new Date().toISOString();
    workerLog.debug(
      {
        jobId: String(job.id),
        campaignId: job.data.campaignId,
        deliveryId: job.data.deliveryId,
      },
      'BullMQ delivery job completed'
    );
  });

  deliveryWorker.on('failed', (job, err) => {
    workerState.failedJobs += 1;
    workerState.lastHeartbeatAt = new Date().toISOString();
    workerLog.warn(
      {
        jobId: job ? String(job.id) : 'unknown',
        campaignId: job?.data?.campaignId,
        deliveryId: job?.data?.deliveryId,
        attemptsMade: job?.attemptsMade,
        err: err.message,
      },
      'BullMQ delivery job attempt failed'
    );
  });

  deliveryWorker.on('stalled', (jobId) => {
    workerLog.warn({ jobId }, 'Detected stalled delivery job — BullMQ will recover automatically');
  });

  // 3. Periodic Worker Heartbeat in Redis for Health & Observability (Module 5)
  const publishHeartbeat = async () => {
    workerState.lastHeartbeatAt = new Date().toISOString();
    try {
      const redis = getReadyRedisClient();
      if (redis) {
        const ttlSeconds = Math.max(15, Math.ceil((env.WORKER_HEARTBEAT_INTERVAL_MS * 3) / 1000));
        await redis.set(
          getWorkerHeartbeatRedisKey(workerId),
          JSON.stringify(workerState),
          'EX',
          ttlSeconds
        );
      }
    } catch {
      // Non-fatal if Redis is temporarily reconnecting
    }
  };

  void publishHeartbeat();
  const heartbeatTimer = setInterval(() => {
    void publishHeartbeat();
  }, env.WORKER_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  workerLog.info(
    { concurrency, batchSize: env.CAMPAIGN_BATCH_SIZE },
    'BullMQ Dispatch & Delivery Workers started'
  );

  const stop = async () => {
    clearInterval(heartbeatTimer);
    activeLocalWorkers.delete(workerId);
    workerLog.info('Closing BullMQ workers and waiting for in-flight jobs to finish...');
    await Promise.all([dispatchWorker.close(), deliveryWorker.close()]);
    try {
      const redis = getReadyRedisClient();
      if (redis) {
        await redis.del(getWorkerHeartbeatRedisKey(workerId));
      }
    } catch {
      // Ignore cleanup error
    }
    workerLog.info('BullMQ workers closed gracefully');
  };

  return {
    workerId,
    dispatchWorker,
    deliveryWorker,
    stop,
  };
}

/**
 * Returns active worker heartbeats from Redis (and in-process workers).
 */
export async function getActiveWorkersHealth() {
  const workersMap = new Map<string, Record<string, unknown>>();

  for (const [id, state] of activeLocalWorkers.entries()) {
    workersMap.set(id, { ...state });
  }

  try {
    const redis = getReadyRedisClient();
    if (redis) {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          'worker:heartbeat:*',
          'COUNT',
          50
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          const values = await redis.mget(...keys);
          for (const raw of values) {
            if (raw) {
              const parsed = JSON.parse(raw) as { workerId: string };
              workersMap.set(parsed.workerId, parsed);
            }
          }
        }
      } while (cursor !== '0');
    }
  } catch {
    // Fallback to local workers list
  }

  const workers = Array.from(workersMap.values());
  return {
    activeWorkerCount: workers.length,
    workers,
  };
}

async function bootstrapWorkerProcess() {
  try {
    await connectDatabase();
    getRedisClient();

    const runtime = startWorkers(env.WORKER_CONCURRENCY);

    let isShuttingDown = false;
    const gracefulShutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.info({ signal, workerId: runtime.workerId }, 'Received shutdown signal in Worker process');
      await runtime.stop();
      await closeQueues();
      await closeAllRedisConnections();
      await disconnectDatabase();
      process.exit(0);
    };

    process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to bootstrap Worker process');
    process.exit(1);
  }
}

if (require.main === module) {
  void bootstrapWorkerProcess();
}
