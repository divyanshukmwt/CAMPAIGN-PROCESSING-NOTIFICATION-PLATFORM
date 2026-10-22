import os from 'os';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { env } from '../src/config/env';
import { CampaignModel } from '../src/models/Campaign';
import { DeliveryModel } from '../src/models/Delivery';
import { processCampaignDispatch } from '../src/services/deliveryProcessor';
import { createCampaign } from '../src/services/campaignService';
import { drainCampaignDeliveries } from '../src/services/embeddedWorkerRunner';
import {
  getProviderMetrics,
  resetProviderMetrics,
} from '../src/services/mockProvider';
import { logger } from '../src/utils/logger';

const BENCHMARK_MONGO_URI =
  process.env.BENCHMARK_MONGODB_URI ||
  'mongodb://127.0.0.1:27017/campaign_platform_benchmark';

async function run5kBenchmark() {
  if (process.env.BENCH_VERBOSE !== 'true') {
    logger.level = 'silent';
  }
  // Use controlled low-latency mock settings for repeatable load testing
  env.PROVIDER_MIN_LATENCY_MS = Number(process.env.BENCH_MIN_LATENCY_MS ?? 2);
  env.PROVIDER_MAX_LATENCY_MS = Number(process.env.BENCH_MAX_LATENCY_MS ?? 6);
  env.WORKER_CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 25);
  env.CAMPAIGN_BATCH_SIZE = Number(process.env.BENCH_BATCH_SIZE ?? 250);

  console.log('==============================================================');
  console.log('  CAMPAIGN PROCESSING PLATFORM — 5,000 RECIPIENT BENCHMARK');
  console.log('==============================================================');
  console.log(`Environment : ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`CPU         : ${os.cpus()[0]?.model || 'Unknown CPU'} (${os.cpus().length} cores)`);
  console.log(`Node.js     : ${process.version}`);
  console.log(`Concurrency : ${env.WORKER_CONCURRENCY} concurrent workers`);
  console.log(`Batch Size  : ${env.CAMPAIGN_BATCH_SIZE} recipients/batch`);
  console.log(`Mock Latency: ${env.PROVIDER_MIN_LATENCY_MS}ms – ${env.PROVIDER_MAX_LATENCY_MS}ms`);
  console.log('--------------------------------------------------------------');

  await connectDatabase(BENCHMARK_MONGO_URI);
  await CampaignModel.syncIndexes();
  await DeliveryModel.syncIndexes();

  await CampaignModel.deleteMany({});
  await DeliveryModel.deleteMany({});
  resetProviderMetrics();

  // Construct 5,000 controlled recipients:
  // - 4,800 normal valid recipients (succeed on attempt 1)
  // - 100 transient-failure recipients (fail on attempt 1 with 429, succeed on attempt 2)
  // - 50 permanent-failure recipients (fail immediately on attempt 1 with 400 UnrecoverableError)
  // - 25 invalid email addresses (skipped during validation)
  // - 25 duplicate email addresses (skipped during deduplication)
  const recipients: Array<{ recipient: string; name: string }> = [];

  for (let i = 1; i <= 4800; i++) {
    recipients.push({
      recipient: `bench-user-${i}@example.com`,
      name: `Benchmark User ${i}`,
    });
  }
  for (let i = 1; i <= 100; i++) {
    recipients.push({
      recipient: `retry-once-bench-${i}@example.com`,
      name: `Transient Retry User ${i}`,
    });
  }
  for (let i = 1; i <= 50; i++) {
    recipients.push({
      recipient: `perm-fail-bench-${i}@example.com`,
      name: `Permanent Bounce User ${i}`,
    });
  }
  for (let i = 1; i <= 25; i++) {
    recipients.push({
      recipient: `malformed-email-row-${i}`,
      name: `Invalid Format User ${i}`,
    });
  }
  for (let i = 1; i <= 25; i++) {
    recipients.push({
      recipient: `bench-user-${i}@example.com`,
      name: `Duplicate User ${i}`,
    });
  }

  const totalStart = Date.now();

  // Phase 1: Campaign Creation, Validation, Deduplication & Durable MongoDB Insertion
  const ingestStart = Date.now();
  const { campaign } = await createCampaign({
    tenantId: 'benchmark-tenant',
    idempotencyKey: `bench_5k_${Date.now()}`,
    name: '5,000 Recipient Load Benchmark Campaign',
    channel: 'email',
    subject: 'Load Test Notification',
    messageTemplate: 'Hello {{name}}, this is a 5,000-recipient benchmark test.',
    recipients,
    skipQueueEnqueue: true,
    config: {
      batchSize: env.CAMPAIGN_BATCH_SIZE,
      maxAttempts: 4,
      backoffDelayMs: 50,
      simulatedTransientFailureRate: 0,
      simulatedPermanentFailureRate: 0,
    },
  });
  const ingestDurationMs = Date.now() - ingestStart;

  // Phase 2: Batch Queue Dispatch + Concurrent Worker Processing (with Retries)
  const processStart = Date.now();
  const dispatchResult = await processCampaignDispatch({
    campaignId: campaign._id.toString(),
    tenantId: 'benchmark-tenant',
    batchSize: env.CAMPAIGN_BATCH_SIZE,
    triggeredBy: 'create',
  });

  await drainCampaignDeliveries(
    campaign._id.toString(),
    env.WORKER_CONCURRENCY,
    true
  );
  const processDurationMs = Date.now() - processStart;
  const totalDurationMs = Date.now() - totalStart;

  const finalCampaign = await CampaignModel.findById(campaign._id).lean();
  const providerMetrics = getProviderMetrics();

  const processedDeliveries =
    (finalCampaign?.stats.succeeded || 0) + (finalCampaign?.stats.failed || 0);
  const throughputPerSec = Number(
    ((processedDeliveries / Math.max(1, processDurationMs)) * 1000).toFixed(2)
  );
  const endToEndThroughputPerSec = Number(
    ((5000 / Math.max(1, totalDurationMs)) * 1000).toFixed(2)
  );

  console.log(`Ingestion & Validation (5,000 rows) : ${ingestDurationMs} ms`);
  console.log(`Batch Enqueued Count                : ${dispatchResult.enqueuedCount} jobs (${Math.ceil(dispatchResult.enqueuedCount / env.CAMPAIGN_BATCH_SIZE)} batches)`);
  console.log(`Worker Processing Duration          : ${processDurationMs} ms`);
  console.log(`Total End-to-End Duration           : ${totalDurationMs} ms (${(totalDurationMs / 1000).toFixed(2)} s)`);
  console.log(`Worker Delivery Throughput          : ${throughputPerSec} deliveries/sec`);
  console.log(`End-to-End Campaign Throughput      : ${endToEndThroughputPerSec} recipients/sec`);
  console.log('--------------------------------------------------------------');
  console.log('Final Campaign Status               :', finalCampaign?.status);
  console.log('Final Campaign Stats                :', JSON.stringify(finalCampaign?.stats));
  console.log('Provider Telemetry                  :', JSON.stringify(providerMetrics));
  console.log('==============================================================');

  await CampaignModel.deleteMany({});
  await DeliveryModel.deleteMany({});
  await disconnectDatabase();
}

void run5kBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
