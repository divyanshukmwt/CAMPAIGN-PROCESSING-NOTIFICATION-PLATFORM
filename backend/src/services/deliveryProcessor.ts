import { UnrecoverableError } from 'bullmq';
import mongoose from 'mongoose';
import { CampaignModel, CampaignStatus, ICampaign } from '../models/Campaign';
import { DeliveryModel } from '../models/Delivery';
import { invalidateTenantCampaignCache } from './cacheService';
import {
  PermanentProviderError,
  ProviderError,
  sendViaMockProvider,
} from './mockProvider';
import {
  CampaignDispatchJobData,
  DeliveryJobData,
  enqueueDeliveryBatch,
  getCampaignRuntimeState,
  publishCampaignEvent,
  setCampaignRuntimeState,
} from '../queues/campaignQueues';
import { createContextLogger } from '../utils/logger';

// Short-lived in-memory cache for campaign metadata inside the worker to minimize DB reads during 5k bursts
interface CachedCampaignMeta {
  campaign: ICampaign;
  expiresAt: number;
}
const workerCampaignCache = new Map<string, CachedCampaignMeta>();

async function getCampaignMetaForWorker(campaignId: string): Promise<ICampaign | null> {
  const cached = workerCampaignCache.get(campaignId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.campaign;
  }

  const doc = await CampaignModel.findById(campaignId).lean<ICampaign>();
  if (doc) {
    workerCampaignCache.set(campaignId, {
      campaign: doc,
      expiresAt: Date.now() + 3000,
    });
  }
  return doc;
}

export function clearWorkerCampaignMetaCache(campaignId?: string): void {
  if (campaignId) {
    workerCampaignCache.delete(campaignId);
  } else {
    workerCampaignCache.clear();
  }
}

/**
 * Atomically checks if all deliveries for a campaign have reached a terminal state
 * ('succeeded', 'failed', 'skipped') and transitions the campaign to
 * 'completed', 'partially_failed', or 'failed'.
 */
export async function checkAndFinalizeCampaignIfComplete(
  campaignId: string
): Promise<CampaignStatus | null> {
  const campaign = await CampaignModel.findById(campaignId).lean<ICampaign>();
  if (!campaign) return null;

  if (!['processing', 'scheduled'].includes(campaign.status)) {
    return campaign.status;
  }

  const { total, queued, processing, succeeded, failed, skipped } = campaign.stats;
  const terminalCount = succeeded + failed + skipped;

  if (queued === 0 && processing === 0 && terminalCount >= total && total > 0) {
    let finalStatus: CampaignStatus = 'completed';
    if (failed > 0 && succeeded > 0) {
      finalStatus = 'partially_failed';
    } else if (failed > 0 && succeeded === 0) {
      finalStatus = 'failed';
    }

    const updated = await CampaignModel.findOneAndUpdate(
      {
        _id: campaignId,
        status: { $in: ['processing', 'scheduled'] },
        'stats.queued': 0,
        'stats.processing': 0,
      },
      {
        $set: {
          status: finalStatus,
          completedAt: new Date(),
        },
      },
      { new: true }
    );

    if (updated) {
      clearWorkerCampaignMetaCache(campaignId);
      await setCampaignRuntimeState(campaignId, finalStatus);
      await invalidateTenantCampaignCache(updated.tenantId, campaignId);
      await publishCampaignEvent({
        type: 'campaign_completed',
        campaignId,
        tenantId: updated.tenantId,
        status: finalStatus,
        timestamp: new Date().toISOString(),
      });
      return finalStatus;
    }
  }

  return campaign.status;
}

/**
 * Processes a Campaign Dispatch job:
 * Transitions the campaign to 'processing' and streams 'queued' deliveries into BullMQ
 * in manageable batches (Module 2).
 */
export async function processCampaignDispatch(
  data: CampaignDispatchJobData,
  jobId = 'dispatch-job'
): Promise<{ enqueuedCount: number; status: string }> {
  const log = createContextLogger({
    campaignId: data.campaignId,
    jobId,
    tenantId: data.tenantId,
  });

  const campaign = await CampaignModel.findById(data.campaignId);
  if (!campaign) {
    log.warn('Campaign not found during dispatch — skipping');
    return { enqueuedCount: 0, status: 'not_found' };
  }

  if (['paused', 'cancelled', 'completed'].includes(campaign.status)) {
    log.info({ status: campaign.status }, 'Campaign is not runnable — skipping dispatch');
    return { enqueuedCount: 0, status: campaign.status };
  }

  // Transition scheduled/draft/partially_failed/failed -> processing
  if (campaign.status !== 'processing') {
    campaign.status = 'processing';
    if (!campaign.startedAt) {
      campaign.startedAt = new Date();
    }
    campaign.completedAt = null;
    await campaign.save();
  }

  await setCampaignRuntimeState(data.campaignId, 'processing');
  await invalidateTenantCampaignCache(campaign.tenantId, data.campaignId);

  const batchSize = Math.max(1, data.batchSize || campaign.config.batchSize || 250);
  let lastId: mongoose.Types.ObjectId | null = null;
  let totalEnqueued = 0;

  while (true) {
    const runtimeState = await getCampaignRuntimeState(data.campaignId);
    if (runtimeState === 'paused' || runtimeState === 'cancelled') {
      log.info(
        { runtimeState, totalEnqueued },
        'Halting batch dispatch early because campaign was paused or cancelled'
      );
      break;
    }

    const query: Record<string, unknown> = {
      campaignId: campaign._id,
      status: 'queued',
    };
    if (lastId) {
      query._id = { $gt: lastId };
    }

    const batch = await DeliveryModel.find(query)
      .sort({ _id: 1 })
      .limit(batchSize)
      .select('_id deliveryId recipient maxAttempts attemptsMade')
      .lean();

    if (batch.length === 0) {
      break;
    }

    lastId = batch[batch.length - 1]._id as mongoose.Types.ObjectId;

    const jobs: DeliveryJobData[] = batch.map((d) => ({
      deliveryId: d.deliveryId,
      campaignId: data.campaignId,
      tenantId: campaign.tenantId,
      recipient: d.recipient,
      maxAttempts: d.maxAttempts || campaign.config.maxAttempts || 4,
      backoffDelayMs: campaign.config.backoffDelayMs || 1000,
      manualRetryEpoch: data.triggeredBy === 'retry' || data.triggeredBy === 'resume'
        ? (d.attemptsMade || 0) + 1
        : undefined,
    }));

    const enqueued = await enqueueDeliveryBatch(jobs, batchSize);
    totalEnqueued += enqueued;

    log.info(
      { batchCount: enqueued, totalEnqueued },
      'Enqueued batch of recipient deliveries into BullMQ'
    );
  }

  await checkAndFinalizeCampaignIfComplete(data.campaignId);
  return { enqueuedCount: totalEnqueued, status: 'dispatched' };
}

/**
 * Processes an individual recipient delivery job with:
 * - Fast pause/cancel check
 * - Atomic MongoDB state transition ('queued' -> 'processing')
 * - Provider Idempotency-Key deduplication
 * - Retryable (exponential backoff) vs. Permanent (UnrecoverableError) handling
 * - Zero-drift atomic campaign counter updates (never double-counting retries)
 */
export async function processDeliveryJob(
  data: DeliveryJobData,
  jobId = 'delivery-job',
  attemptNumber = 1
): Promise<{
  status: 'succeeded' | 'skipped' | 'deferred' | 'already_processed';
  providerMessageId?: string;
  deduplicated?: boolean;
}> {
  const log = createContextLogger({
    campaignId: data.campaignId,
    deliveryId: data.deliveryId,
    jobId,
    tenantId: data.tenantId,
  });

  // 1. Check fast campaign runtime state (paused or cancelled)
  let runtimeState = await getCampaignRuntimeState(data.campaignId);
  if (!runtimeState) {
    const campaignDoc = await getCampaignMetaForWorker(data.campaignId);
    runtimeState = campaignDoc?.status ?? null;
  }

  if (runtimeState === 'paused') {
    log.info('Campaign is currently paused — deferring delivery without burning attempt');
    return { status: 'deferred' };
  }

  if (runtimeState === 'cancelled') {
    const cancelledDoc = await DeliveryModel.findOneAndUpdate(
      {
        deliveryId: data.deliveryId,
        status: 'queued',
      },
      {
        $set: {
          status: 'skipped',
          failureType: 'cancelled',
          lastError: 'Campaign was cancelled before delivery execution',
          errorCode: 'CAMPAIGN_CANCELLED',
          completedAt: new Date(),
        },
      },
      { new: true }
    );

    if (cancelledDoc) {
      await CampaignModel.updateOne(
        { _id: data.campaignId },
        { $inc: { 'stats.queued': -1, 'stats.skipped': 1 } }
      );
      await invalidateTenantCampaignCache(data.tenantId, data.campaignId);
    }
    return { status: 'skipped' };
  }

  // 2. Atomically claim the delivery record in MongoDB
  // Only 'queued' (or 'processing' from a crashed/stalled worker) can be claimed.
  // Terminal states ('succeeded', 'failed', 'skipped') CANNOT be claimed!
  const priorDelivery = await DeliveryModel.findOneAndUpdate(
    {
      deliveryId: data.deliveryId,
      status: { $in: ['queued', 'processing'] },
    },
    {
      $set: {
        status: 'processing',
        lastAttemptAt: new Date(),
        jobId,
      },
    },
    { new: false }
  );

  if (!priorDelivery) {
    log.info('Delivery already in terminal state — skipping duplicate execution');
    return { status: 'already_processed' };
  }

  // Only adjust queued -> processing counter if the prior state was 'queued'
  // (Prevents double-counting if recovering a stalled job that was already 'processing')
  if (priorDelivery.status === 'queued') {
    await CampaignModel.updateOne(
      { _id: data.campaignId },
      { $inc: { 'stats.queued': -1, 'stats.processing': 1 } }
    );
  }

  const campaignMeta = await getCampaignMetaForWorker(data.campaignId);
  if (!campaignMeta) {
    throw new UnrecoverableError(`Campaign ${data.campaignId} no longer exists`);
  }

  const maxAttempts = data.maxAttempts || priorDelivery.maxAttempts || campaignMeta.config.maxAttempts || 4;
  const effectiveAttempt = Math.max(attemptNumber, (priorDelivery.attemptsMade || 0) + 1);

  // 3. Invoke Mock Notification Provider with deterministic deliveryId as Idempotency-Key
  try {
    const providerRes = await sendViaMockProvider({
      deliveryId: data.deliveryId,
      idempotencyKey: data.deliveryId,
      campaignId: data.campaignId,
      channel: priorDelivery.channel,
      recipient: priorDelivery.recipient,
      subject: campaignMeta.subject,
      message: campaignMeta.messageTemplate,
      attemptNumber: effectiveAttempt,
      metadata: priorDelivery.metadata,
      simulatedTransientFailureRate: campaignMeta.config.simulatedTransientFailureRate,
      simulatedPermanentFailureRate: campaignMeta.config.simulatedPermanentFailureRate,
    });

    // 4A. Atomic transition: 'processing' -> 'succeeded'
    const succeededDelivery = await DeliveryModel.findOneAndUpdate(
      {
        deliveryId: data.deliveryId,
        status: 'processing',
      },
      {
        $set: {
          status: 'succeeded',
          providerMessageId: providerRes.providerMessageId,
          failureType: null,
          lastError: null,
          errorCode: null,
          completedAt: new Date(),
        },
        $inc: { attemptsMade: 1 },
        $push: {
          attemptHistory: {
            attempt: effectiveAttempt,
            status: 'succeeded',
            timestamp: new Date(),
            durationMs: providerRes.durationMs,
            providerMessageId: providerRes.providerMessageId,
            deduplicated: providerRes.deduplicated,
          },
        },
      },
      { new: true }
    );

    if (succeededDelivery) {
      await CampaignModel.updateOne(
        { _id: data.campaignId },
        { $inc: { 'stats.processing': -1, 'stats.succeeded': 1 } }
      );
      await checkAndFinalizeCampaignIfComplete(data.campaignId);
      await invalidateTenantCampaignCache(data.tenantId, data.campaignId);
      await publishCampaignEvent({
        type: 'delivery_updated',
        campaignId: data.campaignId,
        tenantId: data.tenantId,
        timestamp: new Date().toISOString(),
      });
    }

    log.info(
      {
        attempt: effectiveAttempt,
        providerMessageId: providerRes.providerMessageId,
        deduplicated: providerRes.deduplicated,
        durationMs: providerRes.durationMs,
      },
      'Delivery succeeded'
    );

    return {
      status: 'succeeded',
      providerMessageId: providerRes.providerMessageId,
      deduplicated: providerRes.deduplicated,
    };
  } catch (err: unknown) {
    const providerErr = err instanceof ProviderError ? err : null;
    const isPermanent =
      err instanceof PermanentProviderError ||
      (providerErr !== null && !providerErr.retryable);
    const errorMessage = err instanceof Error ? err.message : 'Unknown delivery error';
    const errorCode = providerErr?.code || 'DELIVERY_ERROR';
    const isFinalAttempt = isPermanent || effectiveAttempt >= maxAttempts;

    if (!isFinalAttempt) {
      // 4B-1. Transient Retryable Error with attempts remaining:
      // Transition 'processing' -> 'queued' so campaign stats remain 100% accurate and never double-count!
      const revertedToQueued = await DeliveryModel.findOneAndUpdate(
        {
          deliveryId: data.deliveryId,
          status: 'processing',
        },
        {
          $set: {
            status: 'queued',
            failureType: 'transient',
            lastError: errorMessage,
            errorCode,
          },
          $inc: { attemptsMade: 1 },
          $push: {
            attemptHistory: {
              attempt: effectiveAttempt,
              status: 'failed_transient',
              timestamp: new Date(),
              error: errorMessage,
              errorCode,
            },
          },
        },
        { new: true }
      );

      if (revertedToQueued) {
        await CampaignModel.updateOne(
          { _id: data.campaignId },
          { $inc: { 'stats.processing': -1, 'stats.queued': 1 } }
        );
      }

      log.warn(
        {
          attempt: effectiveAttempt,
          maxAttempts,
          errorCode,
          errorMessage,
        },
        'Transient provider failure — returning delivery to queued for exponential backoff retry'
      );

      throw err;
    }

    // 4B-2. Permanent Error OR Final Retry Attempt Exhausted:
    // Transition 'processing' -> 'failed'
    const failedDelivery = await DeliveryModel.findOneAndUpdate(
      {
        deliveryId: data.deliveryId,
        status: 'processing',
      },
      {
        $set: {
          status: 'failed',
          failureType: isPermanent ? 'permanent' : 'transient',
          lastError: errorMessage,
          errorCode,
          completedAt: new Date(),
        },
        $inc: { attemptsMade: 1 },
        $push: {
          attemptHistory: {
            attempt: effectiveAttempt,
            status: isPermanent ? 'failed_permanent' : 'failed_transient',
            timestamp: new Date(),
            error: errorMessage,
            errorCode,
          },
        },
      },
      { new: true }
    );

    if (failedDelivery) {
      await CampaignModel.updateOne(
        { _id: data.campaignId },
        { $inc: { 'stats.processing': -1, 'stats.failed': 1 } }
      );
      await checkAndFinalizeCampaignIfComplete(data.campaignId);
      await invalidateTenantCampaignCache(data.tenantId, data.campaignId);
      await publishCampaignEvent({
        type: 'delivery_updated',
        campaignId: data.campaignId,
        tenantId: data.tenantId,
        timestamp: new Date().toISOString(),
      });
    }

    log.error(
      {
        attempt: effectiveAttempt,
        maxAttempts,
        failureType: isPermanent ? 'permanent' : 'transient',
        errorCode,
        errorMessage,
      },
      isPermanent
        ? 'Permanent delivery failure — aborting retries via UnrecoverableError'
        : 'Delivery failed permanently after exhausting all retry attempts'
    );

    if (isPermanent) {
      throw new UnrecoverableError(errorMessage);
    }
    throw err;
  }
}
