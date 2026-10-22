import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { CampaignModel } from '../src/models/Campaign';
import { DeliveryModel } from '../src/models/Delivery';
import { createRateLimiter, resetRateLimiterForTesting } from '../src/middleware/rateLimiter';
import {
  getInMemoryQueueSnapshot,
  resetInMemoryQueues,
} from '../src/queues/campaignQueues';
import { resetCacheForTesting } from '../src/services/cacheService';
import { processCampaignDispatch } from '../src/services/deliveryProcessor';
import { resetProviderMetrics } from '../src/services/mockProvider';

const TEST_MONGO_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/campaign_platform_test';

describe('Module 7 — Automated Integration Tests (Part 1: Creation, Enqueueing, Idempotency, Cache & Rate Limiting)', () => {
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
  });

  afterAll(async () => {
    await CampaignModel.deleteMany({});
    await DeliveryModel.deleteMany({});
    await disconnectDatabase();
  });

  it('1. Campaign creation & enqueueing: validates JSON/CSV recipients, records skipped entries, and enqueues batch jobs', async () => {
    const csvPayload = [
      'email,name,plan',
      'Alice@Example.com,Alice,pro',
      'bob@example.com,Bob,starter',
      'alice@example.com,Alice Duplicate,free',
      'not-a-valid-email,Broken Row,free',
      'charlie@example.com,Charlie,enterprise',
    ].join('\n');

    const res = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha')
      .send({
        name: 'October Product Launch',
        channel: 'email',
        subject: 'Welcome to October Launch',
        messageTemplate: 'Hello {{name}}, check out our new release!',
        csvContent: csvPayload,
        config: {
          batchSize: 2,
          maxAttempts: 4,
          backoffDelayMs: 500,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.idempotentReplay).toBe(false);

    const campaign = res.body.campaign;
    expect(campaign.name).toBe('October Product Launch');
    expect(campaign.status).toBe('processing');
    expect(campaign.stats).toEqual({
      total: 5,
      queued: 3,
      processing: 0,
      succeeded: 0,
      failed: 0,
      skipped: 2,
    });
    expect(campaign.validationReport.validCount).toBe(3);
    expect(campaign.validationReport.invalidCount).toBe(1);
    expect(campaign.validationReport.duplicateCount).toBe(1);

    // Verify durable delivery records in MongoDB
    const deliveries = await DeliveryModel.find({ campaignId: campaign._id }).lean();
    expect(deliveries).toHaveLength(5);
    const queuedDeliveries = deliveries.filter((d) => d.status === 'queued');
    const skippedDeliveries = deliveries.filter((d) => d.status === 'skipped');
    expect(queuedDeliveries).toHaveLength(3);
    expect(skippedDeliveries).toHaveLength(2);

    // Verify dispatch job was enqueued (API enqueued rather than sending directly)
    const queueSnap1 = getInMemoryQueueSnapshot();
    expect(queueSnap1.dispatchJobs).toHaveLength(1);
    expect(queueSnap1.dispatchJobs[0].data.campaignId).toBe(campaign._id);

    // Run dispatcher and verify batch enqueueing of the 3 valid delivery jobs
    const dispatchRes = await processCampaignDispatch(queueSnap1.dispatchJobs[0].data);
    expect(dispatchRes.enqueuedCount).toBe(3);

    const queueSnap2 = getInMemoryQueueSnapshot();
    expect(queueSnap2.deliveryJobs).toHaveLength(3);
  });

  it('1b. Supports scheduling campaigns for a future date and time with delayed dispatch', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha')
      .send({
        name: 'Future Scheduled Campaign',
        channel: 'email',
        messageTemplate: 'Scheduled message body',
        scheduledAt: futureDate,
        recipients: ['future1@example.com', 'future2@example.com'],
      });

    expect(res.status).toBe(201);
    expect(res.body.campaign.status).toBe('scheduled');

    const queueSnap = getInMemoryQueueSnapshot();
    expect(queueSnap.dispatchJobs).toHaveLength(1);
    expect(queueSnap.dispatchJobs[0].delayMs).toBeGreaterThan(3500 * 1000);
  });

  it('2. Duplicate request handling: prevents duplicate campaign creation when retrying with the same Idempotency-Key', async () => {
    const idempotencyKey = 'idem-key-launch-2026-001';
    const payload = {
      name: 'Idempotent Campaign Test',
      channel: 'email',
      messageTemplate: 'Hello world',
      recipients: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
    };

    // First request creates the campaign (201 Created)
    const res1 = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res1.status).toBe(201);
    expect(res1.body.idempotentReplay).toBe(false);

    // Second request (client retry) with the same Idempotency-Key returns 200 OK without duplicating
    const res2 = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.idempotentReplay).toBe(true);
    expect(res2.headers['x-idempotent-replay']).toBe('true');
    expect(res2.body.campaign._id).toBe(res1.body.campaign._id);

    // Verify only 1 campaign and 3 delivery records exist in MongoDB
    const campaignCount = await CampaignModel.countDocuments({ tenantId: 'tenant-alpha' });
    const deliveryCount = await DeliveryModel.countDocuments({
      campaignId: new mongoose.Types.ObjectId(res1.body.campaign._id),
    });
    expect(campaignCount).toBe(1);
    expect(deliveryCount).toBe(3);
  });

  it('3. Cache invalidation & tenant isolation: caches list/summary responses and invalidates on campaign state change', async () => {
    // 1. Create a campaign for tenant-alpha
    const createRes = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha')
      .send({
        name: 'Cache Test Campaign',
        channel: 'email',
        messageTemplate: 'Cache test message',
        recipients: ['cache1@example.com', 'cache2@example.com'],
      });
    const campaignId = createRes.body.campaign._id;

    // 2. First GET /api/campaigns is a CACHE MISS
    const listMiss = await request(app)
      .get('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha');
    expect(listMiss.status).toBe(200);
    expect(listMiss.headers['x-cache']).toBe('MISS');
    expect(listMiss.body.items).toHaveLength(1);
    expect(listMiss.body.items[0].status).toBe('processing');

    // 3. Second GET /api/campaigns is a CACHE HIT
    const listHit = await request(app)
      .get('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha');
    expect(listHit.status).toBe(200);
    expect(listHit.headers['x-cache']).toBe('HIT');

    // 4. Tenant Isolation check: tenant-beta must NOT see tenant-alpha's cached campaigns
    const otherTenantList = await request(app)
      .get('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-beta');
    expect(otherTenantList.status).toBe(200);
    expect(otherTenantList.body.items).toHaveLength(0);

    // 5. Mutate campaign state (Pause campaign) -> must invalidate tenant-alpha cache!
    const pauseRes = await request(app)
      .post(`/api/campaigns/${campaignId}/pause`)
      .set('X-Tenant-ID', 'tenant-alpha');
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.campaign.status).toBe('paused');

    // 6. Subsequent GET /api/campaigns must be a CACHE MISS and return updated 'paused' status
    const listAfterPause = await request(app)
      .get('/api/campaigns')
      .set('X-Tenant-ID', 'tenant-alpha');
    expect(listAfterPause.status).toBe(200);
    expect(listAfterPause.headers['x-cache']).toBe('MISS');
    expect(listAfterPause.body.items[0].status).toBe('paused');
  });

  it('4. Rate-limit enforcement: enforces threshold and returns 429 Too Many Requests with Retry-After header', async () => {
    const express = (await import('express')).default;
    const rateLimitedApp = express();
    rateLimitedApp.use(
      '/test-limited',
      createRateLimiter({
        keyPrefix: 'strict-test',
        windowSeconds: 60,
        maxRequests: 3,
      }),
      (_req, res) => {
        res.status(200).json({ ok: true });
      }
    );

    const r1 = await request(rateLimitedApp).get('/test-limited').set('X-Tenant-ID', 'tenant-rl');
    const r2 = await request(rateLimitedApp).get('/test-limited').set('X-Tenant-ID', 'tenant-rl');
    const r3 = await request(rateLimitedApp).get('/test-limited').set('X-Tenant-ID', 'tenant-rl');
    const r4 = await request(rateLimitedApp).get('/test-limited').set('X-Tenant-ID', 'tenant-rl');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
    expect(r3.headers['x-ratelimit-remaining']).toBe('0');

    // 4th request exceeds limit of 3
    expect(r4.status).toBe(429);
    expect(r4.headers['retry-after']).toBeDefined();
    expect(Number(r4.headers['retry-after'])).toBeGreaterThan(0);
    expect(r4.body.error).toBe('TOO_MANY_REQUESTS');
  });
});
