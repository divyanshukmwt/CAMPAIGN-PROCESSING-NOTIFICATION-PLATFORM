import { UnrecoverableError } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { CampaignModel } from '../src/models/Campaign';
import { DeliveryModel } from '../src/models/Delivery';
import { resetRateLimiterForTesting } from '../src/middleware/rateLimiter';
import { resetInMemoryQueues } from '../src/queues/campaignQueues';
import { resetCacheForTesting } from '../src/services/cacheService';
import {
  clearWorkerCampaignMetaCache,
  processDeliveryJob,
} from '../src/services/deliveryProcessor';
import {
  getProviderMetrics,
  getRecipientSendCount,
  resetProviderMetrics,
  sendViaMockProvider,
} from '../src/services/mockProvider';

const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/campaign_platform_test';

describe('Module 7 — Automated Integration Tests (Part 2: Retries, Permanent Failures, Concurrency & Lifecycle)', () => {
  const app = createApp();

  beforeAll(async () => {
    await connectDatabase(TEST_MONGO_URI);
    await CampaignModel.syncIndexes();
    await DeliveryModel.syncIndexes();
  });

  beforeEach(async () => {
    await CampaignModel.deleteMany({});
    await DeliveryModel.deleteMany({});
    resetCacheForTesting();
    resetRateLimiterForTesting();
    resetInMemoryQueues();
    resetProviderMetrics();
    clearWorkerCampaignMetaCache();
  });

  afterAll(async () => {
    await CampaignModel.deleteMany({});
    await DeliveryModel.deleteMany({});
    await disconnectDatabase();
  });

  it('5. Retry after a transient provider failure: retries with backoff, preserves accurate counters without double-counting, and succeeds on retry', async () => {
    const createRes = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha')
      .send({
        name: 'Transient Retry Campaign',
        channel: 'email',
        messageTemplate: 'Hello retry recipient!',
        recipients: ['retry-once@example.com'],
        config: {
          maxAttempts: 4,
          backoffDelayMs: 100,
          simulatedTransientFailureRate: 0,
        },
      });

    expect(createRes.status).toBe(201);
    const campaignId = createRes.body.campaign._id;

    const delivery = await DeliveryModel.findOne({ campaignId }).lean();
    expect(delivery).toBeTruthy();

    // Attempt 1: Provider fails transiently (429 Rate Limit)
    await expect(
      processDeliveryJob(
        {
          deliveryId: delivery!.deliveryId,
          campaignId,
          tenantId: 'tenant-alpha',
          recipient: delivery!.recipient,
          maxAttempts: 4,
          backoffDelayMs: 100,
        },
        'job_attempt_1',
        1
      )
    ).rejects.toThrow(/Rate limited/i);

    // Verify intermediate state: returned to 'queued', attemptsMade = 1, stats.failed is still 0 (NOT double-counted!)
    const midDelivery = await DeliveryModel.findOne({ deliveryId: delivery!.deliveryId }).lean();
    const midCampaign = await CampaignModel.findById(campaignId).lean();
    expect(midDelivery?.status).toBe('queued');
    expect(midDelivery?.attemptsMade).toBe(1);
    expect(midDelivery?.failureType).toBe('transient');
    expect(midCampaign?.stats).toEqual({
      total: 1,
      queued: 1,
      processing: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });

    // Attempt 2 (Exponential Backoff Retry): Provider succeeds!
    const attempt2Res = await processDeliveryJob(
      {
        deliveryId: delivery!.deliveryId,
        campaignId,
        tenantId: 'tenant-alpha',
        recipient: delivery!.recipient,
        maxAttempts: 4,
        backoffDelayMs: 100,
      },
      'job_attempt_2',
      2
    );

    expect(attempt2Res.status).toBe('succeeded');

    // Verify final delivery & campaign state: completed with 2 attempts recorded and exact counters
    const finalDelivery = await DeliveryModel.findOne({ deliveryId: delivery!.deliveryId }).lean();
    const finalCampaign = await CampaignModel.findById(campaignId).lean();

    expect(finalDelivery?.status).toBe('succeeded');
    expect(finalDelivery?.attemptsMade).toBe(2);
    expect(finalDelivery?.attemptHistory).toHaveLength(2);
    expect(finalDelivery?.attemptHistory[0].status).toBe('failed_transient');
    expect(finalDelivery?.attemptHistory[1].status).toBe('succeeded');

    expect(finalCampaign?.status).toBe('completed');
    expect(finalCampaign?.stats).toEqual({
      total: 1,
      queued: 0,
      processing: 0,
      succeeded: 1,
      failed: 0,
      skipped: 0,
    });
  });

  it('6. Permanent failure handling & manual reprocessing: throws UnrecoverableError immediately without extra retries and supports inspection & manual retry', async () => {
    const createRes = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha')
      .send({
        name: 'Permanent Failure Campaign',
        channel: 'email',
        messageTemplate: 'Testing permanent bounce',
        recipients: ['good@example.com', 'perm-fail@example.com'],
        config: {
          maxAttempts: 4,
          simulatedTransientFailureRate: 0,
        },
      });

    const campaignId = createRes.body.campaign._id;
    const deliveries = await DeliveryModel.find({ campaignId }).lean();
    const goodDelivery = deliveries.find((d) => d.recipient === 'good@example.com')!;
    const permFailDelivery = deliveries.find((d) => d.recipient === 'perm-fail@example.com')!;

    // Process good recipient -> succeeds
    await processDeliveryJob(
      {
        deliveryId: goodDelivery.deliveryId,
        campaignId,
        tenantId: 'tenant-alpha',
        recipient: goodDelivery.recipient,
        maxAttempts: 4,
        backoffDelayMs: 100,
      },
      'job_good',
      1
    );

    // Process permanent bounce recipient -> throws BullMQ UnrecoverableError on Attempt 1
    await expect(
      processDeliveryJob(
        {
          deliveryId: permFailDelivery.deliveryId,
          campaignId,
          tenantId: 'tenant-alpha',
          recipient: permFailDelivery.recipient,
          maxAttempts: 4,
          backoffDelayMs: 100,
        },
        'job_perm_fail',
        1
      )
    ).rejects.toBeInstanceOf(UnrecoverableError);

    // Campaign should now be 'partially_failed' (1 succeeded, 1 failed)
    const campaignAfter = await CampaignModel.findById(campaignId).lean();
    expect(campaignAfter?.status).toBe('partially_failed');
    expect(campaignAfter?.stats).toEqual({
      total: 2,
      queued: 0,
      processing: 0,
      succeeded: 1,
      failed: 1,
      skipped: 0,
    });

    // Inspect failed deliveries via API (Module 5 & 6)
    const inspectRes = await request(app)
      .get(`/api/campaigns/${campaignId}/deliveries?status=failed`)
      .set('X-Tenant-ID', 'tenant-alpha');

    expect(inspectRes.status).toBe(200);
    expect(inspectRes.body.items).toHaveLength(1);
    expect(inspectRes.body.items[0].deliveryId).toBe(permFailDelivery.deliveryId);
    expect(inspectRes.body.items[0].failureType).toBe('permanent');
    expect(inspectRes.body.items[0].attemptsMade).toBe(1);

    // Manually reprocess the failed delivery via POST /api/campaigns/:id/retry
    const retryRes = await request(app)
      .post(`/api/campaigns/${campaignId}/retry`)
      .set('X-Tenant-ID', 'tenant-alpha')
      .send({ deliveryIds: [permFailDelivery.deliveryId] });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.retriedCount).toBe(1);
    expect(retryRes.body.campaign.status).toBe('processing');
    expect(retryRes.body.campaign.stats).toEqual({
      total: 2,
      queued: 1,
      processing: 0,
      succeeded: 1,
      failed: 0,
      skipped: 0,
    });
  });

  it('7. Concurrent processing & worker crash deduplication: 10 racing workers + post-provider crash never send duplicate notifications', async () => {
    const createRes = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha')
      .send({
        name: 'High Concurrency Deduplication Test',
        channel: 'email',
        messageTemplate: 'Concurrency test message',
        recipients: ['concurrent-user@example.com', 'crashed-worker-user@example.com'],
        config: {
          maxAttempts: 4,
          simulatedTransientFailureRate: 0,
        },
      });

    const campaignId = createRes.body.campaign._id;
    const deliveries = await DeliveryModel.find({ campaignId }).lean();
    const concurrentDel = deliveries.find((d) => d.recipient === 'concurrent-user@example.com')!;
    const crashDel = deliveries.find((d) => d.recipient === 'crashed-worker-user@example.com')!;

    // Part A: 10 concurrent workers race on the exact same delivery simultaneously
    const raceResults = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        processDeliveryJob(
          {
            deliveryId: concurrentDel.deliveryId,
            campaignId,
            tenantId: 'tenant-alpha',
            recipient: concurrentDel.recipient,
            maxAttempts: 4,
            backoffDelayMs: 100,
          },
          `job_race_${idx}`,
          1
        )
      )
    );

    const succeededWorkers = raceResults.filter((r) => r.status === 'succeeded');
    expect(succeededWorkers).toHaveLength(1);
    expect(getRecipientSendCount(campaignId, 'concurrent-user@example.com')).toBe(1);

    // Part B: Simulate Worker 1 succeeding at the external provider, then CRASHING before MongoDB persists 'succeeded'
    // Step 1: Worker 1 claims delivery ('processing') and calls provider
    await DeliveryModel.updateOne(
      { deliveryId: crashDel.deliveryId },
      { $set: { status: 'processing', lastAttemptAt: new Date(Date.now() - 20000) } }
    );
    await CampaignModel.updateOne(
      { _id: campaignId },
      { $inc: { 'stats.queued': -1, 'stats.processing': 1 } }
    );

    const providerDirectReceipt = await sendViaMockProvider({
      deliveryId: crashDel.deliveryId,
      idempotencyKey: crashDel.deliveryId,
      campaignId,
      channel: 'email',
      recipient: crashDel.recipient,
      message: 'Crash simulation',
      attemptNumber: 1,
      simulatedTransientFailureRate: 0,
    });
    expect(providerDirectReceipt.deduplicated).toBe(false);

    // Worker 1 crashes here! MongoDB still has status = 'processing'.
    // Step 2: BullMQ stall recovery runs Worker 2 on the stalled job
    const recoveryResult = await processDeliveryJob(
      {
        deliveryId: crashDel.deliveryId,
        campaignId,
        tenantId: 'tenant-alpha',
        recipient: crashDel.recipient,
        maxAttempts: 4,
        backoffDelayMs: 100,
      },
      'job_stalled_recovery',
      2
    );

    // Provider deduplicated the repeat call using Idempotency-Key!
    expect(recoveryResult.status).toBe('succeeded');
    expect(recoveryResult.deduplicated).toBe(true);
    expect(recoveryResult.providerMessageId).toBe(providerDirectReceipt.providerMessageId);

    // External provider only ever dispatched 1 actual message to crashed-worker-user@example.com
    expect(getRecipientSendCount(campaignId, 'crashed-worker-user@example.com')).toBe(1);
    expect(getProviderMetrics().totalDeduplicatedHits).toBeGreaterThanOrEqual(1);

    // Verify campaign completed with exact stats (2 total, 2 succeeded, 0 processing, 0 failed)
    const finalCampaign = await CampaignModel.findById(campaignId).lean();
    expect(finalCampaign?.status).toBe('completed');
    expect(finalCampaign?.stats).toEqual({
      total: 2,
      queued: 0,
      processing: 0,
      succeeded: 2,
      failed: 0,
      skipped: 0,
    });
  });

  it('8. Pause, resume, and cancellation behavior: defers deliveries when paused, processes when resumed, and skips remaining when cancelled', async () => {
    const createRes = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha')
      .send({
        name: 'Lifecycle Control Campaign',
        channel: 'email',
        messageTemplate: 'Lifecycle test',
        recipients: ['u1@example.com', 'u2@example.com', 'u3@example.com'],
        config: {
          simulatedTransientFailureRate: 0,
        },
      });

    const campaignId = createRes.body.campaign._id;
    const deliveries = await DeliveryModel.find({ campaignId }).sort({ recipient: 1 }).lean();

    // 1. Pause campaign via API
    const pauseRes = await request(app)
      .post(`/api/campaigns/${campaignId}/pause`)
      .set('X-Tenant-ID', 'tenant-alpha');
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.campaign.status).toBe('paused');

    // Worker attempting to process u1 while paused defers without sending or burning attempts
    const deferredRes = await processDeliveryJob(
      {
        deliveryId: deliveries[0].deliveryId,
        campaignId,
        tenantId: 'tenant-alpha',
        recipient: deliveries[0].recipient,
        maxAttempts: 4,
        backoffDelayMs: 100,
      },
      'job_u1_paused',
      1
    );
    expect(deferredRes.status).toBe('deferred');
    expect(getRecipientSendCount(campaignId, deliveries[0].recipient)).toBe(0);

    // 2. Resume campaign via API
    const resumeRes = await request(app)
      .post(`/api/campaigns/${campaignId}/resume`)
      .set('X-Tenant-ID', 'tenant-alpha');
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.campaign.status).toBe('processing');

    // Now u1 processes and succeeds!
    const u1Res = await processDeliveryJob(
      {
        deliveryId: deliveries[0].deliveryId,
        campaignId,
        tenantId: 'tenant-alpha',
        recipient: deliveries[0].recipient,
        maxAttempts: 4,
        backoffDelayMs: 100,
      },
      'job_u1_resumed',
      1
    );
    expect(u1Res.status).toBe('succeeded');

    // 3. Cancel campaign before u2 and u3 are processed
    const cancelRes = await request(app)
      .post(`/api/campaigns/${campaignId}/cancel`)
      .set('X-Tenant-ID', 'tenant-alpha');
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.campaign.status).toBe('cancelled');
    expect(cancelRes.body.campaign.stats).toEqual({
      total: 3,
      queued: 0,
      processing: 0,
      succeeded: 1,
      failed: 0,
      skipped: 2,
    });

    // Even if an in-flight BullMQ job for u2 runs after cancellation, it skips without calling provider
    const u2Res = await processDeliveryJob(
      {
        deliveryId: deliveries[1].deliveryId,
        campaignId,
        tenantId: 'tenant-alpha',
        recipient: deliveries[1].recipient,
        maxAttempts: 4,
        backoffDelayMs: 100,
      },
      'job_u2_after_cancel',
      1
    );
    expect(['skipped', 'already_processed']).toContain(u2Res.status);
    expect(getRecipientSendCount(campaignId, deliveries[1].recipient)).toBe(0);
  });
});
