import { UnrecoverableError } from 'bullmq';
import { env } from '../config/env';
import { getReadyRedisClient } from '../config/redis';
import { CampaignModel } from '../models/Campaign';
import { DeliveryModel } from '../models/Delivery';
import { getCampaignRuntimeState } from '../queues/campaignQueues';
import {
  checkAndFinalizeCampaignIfComplete,
  processDeliveryJob,
} from './deliveryProcessor';
import { logger } from '../utils/logger';

let isLoopRunning = false;
let loopTimer: NodeJS.Timeout | null = null;

/**
 * Helper to execute all pending deliveries for a campaign with controlled concurrency
 * and automatic exponential backoff retries when running in standalone/benchmark mode
 * or when Redis is not running locally.
 */
export async function drainCampaignDeliveries(
  campaignId: string,
  concurrency = env.WORKER_CONCURRENCY,
  fastBackoffForTests = false
): Promise<void> {
  const campaign = await CampaignModel.findById(campaignId);
  if (!campaign) return;

  if (['draft', 'paused', 'cancelled', 'completed'].includes(campaign.status)) {
    return;
  }

  if (campaign.status === 'scheduled') {
    if (campaign.scheduledAt && campaign.scheduledAt.getTime() > Date.now()) {
      return;
    }
    campaign.status = 'processing';
    campaign.startedAt = new Date();
    await campaign.save();
  }

  const maxAttempts = campaign.config.maxAttempts || env.DELIVERY_MAX_ATTEMPTS;
  const baseBackoffMs = fastBackoffForTests
    ? 10
    : Math.min(campaign.config.backoffDelayMs || env.DELIVERY_BACKOFF_DELAY_MS, 250);

  while (true) {
    const runtimeState = await getCampaignRuntimeState(campaignId);
    if (runtimeState === 'paused' || runtimeState === 'cancelled') {
      break;
    }

    const queuedDeliveries = await DeliveryModel.find({
      campaignId: campaign._id,
      status: 'queued',
    })
      .sort({ _id: 1 })
      .limit(campaign.config.batchSize || env.CAMPAIGN_BATCH_SIZE)
      .lean();

    if (queuedDeliveries.length === 0) {
      break;
    }

    // Process batch with bounded worker concurrency
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, queuedDeliveries.length) }, async () => {
      while (index < queuedDeliveries.length) {
        const currentIndex = index++;
        const delivery = queuedDeliveries[currentIndex];
        if (!delivery) break;

        const currentState = await getCampaignRuntimeState(campaignId);
        if (currentState === 'paused' || currentState === 'cancelled') {
          break;
        }

        let attempt = (delivery.attemptsMade || 0) + 1;
        while (attempt <= (delivery.maxAttempts || maxAttempts)) {
          try {
            await processDeliveryJob(
              {
                deliveryId: delivery.deliveryId,
                campaignId,
                tenantId: campaign.tenantId,
                recipient: delivery.recipient,
                maxAttempts: delivery.maxAttempts || maxAttempts,
                backoffDelayMs: baseBackoffMs,
              },
              `job_${delivery.deliveryId}_a${attempt}`,
              attempt
            );
            break;
          } catch (err) {
            if (err instanceof UnrecoverableError) {
              break;
            }
            if (attempt >= (delivery.maxAttempts || maxAttempts)) {
              break;
            }
            const expDelay = baseBackoffMs * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, Math.min(expDelay, 1000)));
            attempt++;
          }
        }
      }
    });

    await Promise.all(workers);
  }

  await checkAndFinalizeCampaignIfComplete(campaignId);
}

/**
 * Starts a background polling loop that automatically processes active/scheduled campaigns
 * when Redis is not connected (so local dev without Docker/Redis still processes campaigns seamlessly).
 * When Redis IS connected, the dedicated BullMQ worker process handles all jobs.
 */
export function startFallbackProcessorIfRedisOffline(): void {
  if (env.NODE_ENV === 'test' || loopTimer) return;

  loopTimer = setInterval(async () => {
    if (isLoopRunning) return;
    // If Redis is connected and BullMQ workers are active, let BullMQ handle it
    if (getReadyRedisClient()) return;

    isLoopRunning = true;
    try {
      const now = new Date();
      // Promote due scheduled campaigns
      const dueCampaigns = await CampaignModel.find({
        status: { $in: ['processing', 'scheduled'] },
        $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }],
      })
        .select('_id')
        .limit(5)
        .lean<Array<{ _id: { toString(): string } }>>();

      for (const c of dueCampaigns) {
        await drainCampaignDeliveries(c._id.toString(), env.WORKER_CONCURRENCY, false);
      }
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'Fallback processor tick warning');
    } finally {
      isLoopRunning = false;
    }
  }, 1000);
  loopTimer.unref();
}

export function stopFallbackProcessor(): void {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}
