import crypto from 'crypto';
import { env } from '../config/env';
import { getReadyRedisClient } from '../config/redis';
import { CampaignChannel } from '../utils/idempotency';
import { createContextLogger } from '../utils/logger';

export class ProviderError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly failureType: 'transient' | 'permanent';

  constructor(params: {
    message: string;
    code: string;
    statusCode: number;
    retryable: boolean;
    failureType: 'transient' | 'permanent';
  }) {
    super(params.message);
    this.name = 'ProviderError';
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.retryable = params.retryable;
    this.failureType = params.failureType;
  }
}

export class TransientProviderError extends ProviderError {
  constructor(
    message = 'Upstream notification gateway temporarily unavailable',
    code = 'PROVIDER_TRANSIENT_503',
    statusCode = 503
  ) {
    super({
      message,
      code,
      statusCode,
      retryable: true,
      failureType: 'transient',
    });
    this.name = 'TransientProviderError';
  }
}

export class PermanentProviderError extends ProviderError {
  constructor(
    message = 'Recipient address permanently rejected by gateway (hard bounce)',
    code = 'PROVIDER_PERMANENT_BOUNCE',
    statusCode = 400
  ) {
    super({
      message,
      code,
      statusCode,
      retryable: false,
      failureType: 'permanent',
    });
    this.name = 'PermanentProviderError';
  }
}

export interface ProviderSendRequest {
  deliveryId: string;
  idempotencyKey: string;
  campaignId: string;
  channel: CampaignChannel;
  recipient: string;
  subject?: string;
  message: string;
  attemptNumber: number;
  metadata?: Record<string, unknown>;
  simulatedTransientFailureRate?: number;
  simulatedPermanentFailureRate?: number;
  minLatencyMs?: number;
  maxLatencyMs?: number;
}

export interface ProviderSendResponse {
  success: true;
  providerMessageId: string;
  deduplicated: boolean;
  durationMs: number;
  timestamp: string;
}

interface StoredProviderReceipt {
  providerMessageId: string;
  deliveryId: string;
  recipient: string;
  timestamp: string;
}

// In-memory fallback & test verification counters
const memoryReceiptStore = new Map<string, StoredProviderReceipt>();
const recipientSendCounter = new Map<string, number>();
let totalActualDispatches = 0;
let totalDeduplicatedHits = 0;
let totalTransientErrors = 0;
let totalPermanentErrors = 0;

function getIdempotencyRedisKey(idempotencyKey: string): string {
  return `provider:idemp:${idempotencyKey}`;
}

async function getStoredReceipt(idempotencyKey: string): Promise<StoredProviderReceipt | null> {
  const mem = memoryReceiptStore.get(idempotencyKey);
  if (mem) return mem;

  try {
    const redis = getReadyRedisClient();
    if (redis) {
      const raw = await redis.get(getIdempotencyRedisKey(idempotencyKey));
      if (raw) {
        const parsed = JSON.parse(raw) as StoredProviderReceipt;
        memoryReceiptStore.set(idempotencyKey, parsed);
        return parsed;
      }
    }
  } catch {
    // Fallback to in-memory store if Redis is unreachable
  }
  return null;
}

async function storeReceiptIdempotently(
  idempotencyKey: string,
  receipt: StoredProviderReceipt
): Promise<{ storedNew: boolean; finalReceipt: StoredProviderReceipt }> {
  try {
    const redis = getReadyRedisClient();
    if (redis) {
      const key = getIdempotencyRedisKey(idempotencyKey);
      const setResult = await redis.set(
        key,
        JSON.stringify(receipt),
        'EX',
        env.PROVIDER_IDEMPOTENCY_TTL_SECONDS,
        'NX'
      );
      if (setResult !== 'OK') {
        const existingRaw = await redis.get(key);
        if (existingRaw) {
          const existing = JSON.parse(existingRaw) as StoredProviderReceipt;
          memoryReceiptStore.set(idempotencyKey, existing);
          return { storedNew: false, finalReceipt: existing };
        }
      }
    }
  } catch {
    // Fallback to in-memory check below
  }

  const existingMem = memoryReceiptStore.get(idempotencyKey);
  if (existingMem) {
    return { storedNew: false, finalReceipt: existingMem };
  }

  memoryReceiptStore.set(idempotencyKey, receipt);
  return { storedNew: true, finalReceipt: receipt };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simulates an external Email/SMS/Push Notification Gateway supporting
 * Idempotency-Key deduplication and realistic transient vs. permanent errors.
 */
export async function sendViaMockProvider(
  req: ProviderSendRequest
): Promise<ProviderSendResponse> {
  const start = Date.now();
  const log = createContextLogger({
    campaignId: req.campaignId,
    deliveryId: req.deliveryId,
  });

  // 1. Check Provider Idempotency Store first
  // If a worker previously succeeded at the provider but crashed before updating MongoDB,
  // retrying with the same idempotencyKey returns the original receipt without re-sending!
  const existingReceipt = await getStoredReceipt(req.idempotencyKey);
  if (existingReceipt) {
    totalDeduplicatedHits++;
    log.info(
      {
        idempotencyKey: req.idempotencyKey,
        providerMessageId: existingReceipt.providerMessageId,
      },
      'Provider deduplicated repeat send request via Idempotency-Key'
    );
    return {
      success: true,
      providerMessageId: existingReceipt.providerMessageId,
      deduplicated: true,
      durationMs: Date.now() - start,
      timestamp: existingReceipt.timestamp,
    };
  }

  // 2. Simulate realistic network latency
  const minLatency = req.minLatencyMs ?? env.PROVIDER_MIN_LATENCY_MS;
  const maxLatency = req.maxLatencyMs ?? env.PROVIDER_MAX_LATENCY_MS;
  const latency =
    maxLatency > minLatency
      ? minLatency + Math.floor(Math.random() * (maxLatency - minLatency + 1))
      : minLatency;
  await sleep(latency);

  const lowerRecipient = req.recipient.toLowerCase();
  const simMode = req.metadata?.simulateFailure as string | undefined;

  // 3. Deterministic Permanent Failures (for automated tests & explicit bounce patterns)
  if (
    simMode === 'permanent' ||
    lowerRecipient.includes('perm-fail') ||
    lowerRecipient.includes('hard-bounce') ||
    lowerRecipient.includes('unsubscribed') ||
    lowerRecipient.includes('invalid-domain')
  ) {
    totalPermanentErrors++;
    throw new PermanentProviderError(
      `Permanent failure for ${req.recipient}: Hard bounce / unsubscribed recipient`,
      'PROVIDER_HARD_BOUNCE_400',
      400
    );
  }

  // 4. Deterministic Transient Failures (for retry & backoff testing)
  if (simMode === 'always_transient' || lowerRecipient.includes('always-transient')) {
    totalTransientErrors++;
    throw new TransientProviderError(
      `Upstream gateway timeout for ${req.recipient} (attempt ${req.attemptNumber})`,
      'PROVIDER_TIMEOUT_503',
      503
    );
  }

  if (
    (simMode === 'transient_once' ||
      lowerRecipient.includes('retry-once') ||
      lowerRecipient.includes('transient-once')) &&
    req.attemptNumber < 2
  ) {
    totalTransientErrors++;
    throw new TransientProviderError(
      `Rate limited by upstream provider on attempt ${req.attemptNumber}`,
      'PROVIDER_RATE_LIMIT_429',
      429
    );
  }

  if (
    (simMode === 'transient_twice' || lowerRecipient.includes('retry-twice')) &&
    req.attemptNumber < 3
  ) {
    totalTransientErrors++;
    throw new TransientProviderError(
      `Temporary gateway overload on attempt ${req.attemptNumber}`,
      'PROVIDER_OVERLOAD_503',
      503
    );
  }

  // 5. Probabilistic Failure Simulation (configured at campaign level)
  const permRate = req.simulatedPermanentFailureRate ?? 0;
  if (permRate > 0 && Math.random() < permRate) {
    totalPermanentErrors++;
    throw new PermanentProviderError(
      `Simulated permanent mailbox rejection for ${req.recipient}`,
      'PROVIDER_MAILBOX_REJECTED_400',
      400
    );
  }

  const transientRate =
    req.simulatedTransientFailureRate ?? env.PROVIDER_DEFAULT_TRANSIENT_FAILURE_RATE;
  if (transientRate > 0 && req.attemptNumber === 1 && Math.random() < transientRate) {
    totalTransientErrors++;
    throw new TransientProviderError(
      `Simulated transient gateway error (503) on attempt ${req.attemptNumber}`,
      'PROVIDER_TRANSIENT_503',
      503
    );
  }

  // 6. Atomic Idempotent Commit at Provider
  const newReceipt: StoredProviderReceipt = {
    providerMessageId: `msg_${crypto.randomBytes(10).toString('hex')}`,
    deliveryId: req.deliveryId,
    recipient: req.recipient,
    timestamp: new Date().toISOString(),
  };

  const { storedNew, finalReceipt } = await storeReceiptIdempotently(
    req.idempotencyKey,
    newReceipt
  );

  if (storedNew) {
    totalActualDispatches++;
    const key = `${req.campaignId}:${req.recipient}`;
    recipientSendCounter.set(key, (recipientSendCounter.get(key) || 0) + 1);
  } else {
    totalDeduplicatedHits++;
  }

  return {
    success: true,
    providerMessageId: finalReceipt.providerMessageId,
    deduplicated: !storedNew,
    durationMs: Date.now() - start,
    timestamp: finalReceipt.timestamp,
  };
}

/**
 * Clears a provider idempotency receipt when an admin explicitly requests
 * manual reprocessing of a delivery.
 */
export async function clearProviderIdempotencyKey(idempotencyKey: string): Promise<void> {
  memoryReceiptStore.delete(idempotencyKey);
  try {
    const redis = getReadyRedisClient();
    if (redis) {
      await redis.del(getIdempotencyRedisKey(idempotencyKey));
    }
  } catch {
    // Ignore Redis error if offline
  }
}

export function getProviderMetrics() {
  return {
    totalActualDispatches,
    totalDeduplicatedHits,
    totalTransientErrors,
    totalPermanentErrors,
    uniqueRecipientsSent: recipientSendCounter.size,
  };
}

export function getRecipientSendCount(campaignId: string, recipient: string): number {
  return recipientSendCounter.get(`${campaignId}:${recipient}`) || 0;
}

export function resetProviderMetrics(): void {
  memoryReceiptStore.clear();
  recipientSendCounter.clear();
  totalActualDispatches = 0;
  totalDeduplicatedHits = 0;
  totalTransientErrors = 0;
  totalPermanentErrors = 0;
}
