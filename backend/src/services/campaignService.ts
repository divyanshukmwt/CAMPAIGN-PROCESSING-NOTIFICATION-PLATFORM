import mongoose from 'mongoose';
import { env } from '../config/env';
import {
  CampaignModel,
  CampaignStatus,
  ICampaign,
} from '../models/Campaign';
import { DeliveryModel } from '../models/Delivery';
import {
  buildCampaignDetailCacheKey,
  buildCampaignListCacheKey,
  buildCampaignSummaryCacheKey,
  getCachedJson,
  invalidateTenantCampaignCache,
  setCachedJson,
} from './cacheService';
import {
  enqueueCampaignDispatchJob,
  publishCampaignEvent,
  setCampaignRuntimeState,
} from '../queues/campaignQueues';
import { CampaignChannel, generateDeliveryId } from '../utils/idempotency';
import { logger } from '../utils/logger';
import {
  parseCsvRecipients,
  RawRecipientInput,
  validateAndDeduplicateRecipients,
} from '../utils/recipientValidator';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface CreateCampaignInput {
  tenantId: string;
  idempotencyKey?: string;
  name: string;
  description?: string;
  channel: CampaignChannel;
  subject?: string;
  messageTemplate: string;
  recipients?: Array<string | RawRecipientInput>;
  csvContent?: string | Buffer;
  scheduledAt?: string | Date | null;
  saveAsDraft?: boolean;
  rejectInvalid?: boolean;
  skipQueueEnqueue?: boolean;
  config?: {
    batchSize?: number;
    maxAttempts?: number;
    backoffDelayMs?: number;
    simulatedTransientFailureRate?: number;
    simulatedPermanentFailureRate?: number;
  };
}

export interface CreateCampaignResult {
  campaign: ICampaign;
  idempotentReplay: boolean;
}

/**
 * Creates a campaign, validates & deduplicates recipients, persists durable delivery
 * records in MongoDB, and enqueues the BullMQ dispatch job (never sending directly).
 */
export async function createCampaign(
  input: CreateCampaignInput
): Promise<CreateCampaignResult> {
  const tenantId = input.tenantId || env.DEFAULT_TENANT_ID;

  // 1. Check Idempotency-Key first to prevent duplicate campaign creation on client retry
  if (input.idempotencyKey) {
    const existing = await CampaignModel.findOne({
      tenantId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      logger.info(
        { tenantId, idempotencyKey: input.idempotencyKey, campaignId: existing._id.toString() },
        'Returning existing campaign for duplicate Idempotency-Key request'
      );
      return { campaign: existing, idempotentReplay: true };
    }
  }

  // 2. Parse recipient inputs from CSV and/or JSON array
  const rawRecipientList: Array<string | RawRecipientInput> = [];
  if (input.csvContent) {
    const csvParsed = parseCsvRecipients(input.csvContent);
    rawRecipientList.push(...csvParsed);
  }
  if (Array.isArray(input.recipients) && input.recipients.length > 0) {
    rawRecipientList.push(...input.recipients);
  }

  if (rawRecipientList.length === 0) {
    throw new AppError(
      400,
      'EMPTY_RECIPIENTS',
      'At least one recipient must be provided via JSON array or CSV upload.'
    );
  }

  // 3. Validate and deduplicate recipients
  const validation = validateAndDeduplicateRecipients(input.channel, rawRecipientList);

  if (input.rejectInvalid && validation.report.invalidCount > 0) {
    throw new AppError(
      400,
      'INVALID_RECIPIENT_RECORDS',
      `Recipient validation failed with ${validation.report.invalidCount} invalid record(s).`,
      validation.report
    );
  }

  if (validation.validRecipients.length === 0) {
    throw new AppError(
      400,
      'NO_VALID_RECIPIENTS',
      'None of the submitted recipients passed validation.',
      validation.report
    );
  }

  // 4. Determine initial campaign status and schedule
  let scheduledDate: Date | null = null;
  if (input.scheduledAt) {
    const parsedDate = new Date(input.scheduledAt);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new AppError(400, 'INVALID_SCHEDULE_DATE', 'scheduledAt must be a valid ISO-8601 date.');
    }
    scheduledDate = parsedDate;
  }

  const isFutureSchedule =
    scheduledDate !== null && scheduledDate.getTime() > Date.now() + 1000;

  let initialStatus: CampaignStatus = 'processing';
  if (input.saveAsDraft) {
    initialStatus = 'draft';
  } else if (isFutureSchedule) {
    initialStatus = 'scheduled';
  }

  const campaignId = new mongoose.Types.ObjectId();
  const campaignIdStr = campaignId.toString();

  const batchSize = input.config?.batchSize ?? env.CAMPAIGN_BATCH_SIZE;
  const maxAttempts = input.config?.maxAttempts ?? env.DELIVERY_MAX_ATTEMPTS;
  const backoffDelayMs = input.config?.backoffDelayMs ?? env.DELIVERY_BACKOFF_DELAY_MS;
  const simulatedTransientFailureRate =
    input.config?.simulatedTransientFailureRate ?? env.PROVIDER_DEFAULT_TRANSIENT_FAILURE_RATE;
  const simulatedPermanentFailureRate =
    input.config?.simulatedPermanentFailureRate ?? 0;

  // 5. Create Campaign document in MongoDB (handling concurrent race on Idempotency-Key)
  let campaign: ICampaign;
  try {
    campaign = await CampaignModel.create({
      _id: campaignId,
      tenantId,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      name: input.name.trim(),
      description: input.description?.trim() || '',
      channel: input.channel,
      subject: input.subject?.trim() || '',
      messageTemplate: input.messageTemplate,
      status: initialStatus,
      scheduledAt: scheduledDate,
      startedAt: initialStatus === 'processing' ? new Date() : null,
      stats: {
        total: validation.allRecords.length,
        queued: validation.validRecipients.length,
        processing: 0,
        succeeded: 0,
        failed: 0,
        skipped: validation.skippedRecipients.length,
      },
      validationReport: validation.report,
      config: {
        batchSize,
        maxAttempts,
        backoffDelayMs,
        simulatedTransientFailureRate,
        simulatedPermanentFailureRate,
      },
    });
  } catch (err: any) {
    if (err?.code === 11000 && input.idempotencyKey) {
      const winner = await CampaignModel.findOne({
        tenantId,
        idempotencyKey: input.idempotencyKey,
      });
      if (winner) {
        return { campaign: winner, idempotentReplay: true };
      }
    }
    throw err;
  }

  // 6. Bulk insert durable Delivery documents in chunks of 1,000
  const deliveryDocs = validation.allRecords.map((rec) => {
    const isSkipped = !rec.isValid;
    const deliveryId = isSkipped
      ? `del_skip_${campaignIdStr}_row_${rec.row}`
      : generateDeliveryId(campaignIdStr, input.channel, rec.normalizedRecipient);

    return {
      deliveryId,
      campaignId: campaign._id,
      tenantId,
      channel: input.channel,
      recipient: rec.normalizedRecipient,
      rawRecipient: rec.rawRecipient,
      recipientName: rec.recipientName,
      metadata: rec.metadata,
      status: isSkipped ? 'skipped' : 'queued',
      failureType: isSkipped ? rec.failureType || 'validation' : null,
      lastError: isSkipped ? rec.skipReason || 'Skipped during validation' : null,
      errorCode: isSkipped ? 'VALIDATION_SKIPPED' : null,
      attemptsMade: 0,
      maxAttempts,
      providerMessageId: null,
      jobId: isSkipped ? null : `delivery_${deliveryId}`,
      attemptHistory: [],
      lastAttemptAt: null,
      completedAt: isSkipped ? new Date() : null,
    };
  });

  const INSERT_CHUNK_SIZE = 1000;
  for (let i = 0; i < deliveryDocs.length; i += INSERT_CHUNK_SIZE) {
    const chunk = deliveryDocs.slice(i, i + INSERT_CHUNK_SIZE);
    await DeliveryModel.insertMany(chunk, { ordered: false }).catch((err) => {
      logger.warn(
        { campaignId: campaignIdStr, err: err.message },
        'Partial duplicate ignored during Delivery bulk insert'
      );
    });
  }

  // 7. Set runtime state flag & invalidate tenant cache
  await setCampaignRuntimeState(campaignIdStr, initialStatus);
  await invalidateTenantCampaignCache(tenantId, campaignIdStr);

  // 8. Enqueue BullMQ orchestration job (if not draft)
  if (!input.skipQueueEnqueue && (initialStatus === 'processing' || initialStatus === 'scheduled')) {
    try {
      await enqueueCampaignDispatchJob(
        {
          campaignId: campaignIdStr,
          tenantId,
          batchSize,
          triggeredBy: initialStatus === 'scheduled' ? 'schedule' : 'create',
        },
        initialStatus === 'scheduled' ? scheduledDate : null
      );
    } catch (err) {
      logger.warn(
        { campaignId: campaignIdStr, err: (err as Error).message },
        'Could not enqueue dispatch job immediately (Redis offline or test mode)'
      );
    }
  }

  await publishCampaignEvent({
    type: 'campaign_updated',
    campaignId: campaignIdStr,
    tenantId,
    status: initialStatus,
    timestamp: new Date().toISOString(),
  });

  return { campaign, idempotentReplay: false };
}

export interface ListCampaignsParams {
  tenantId: string;
  page?: number;
  limit?: number;
  status?: string;
  channel?: string;
  search?: string;
}

/**
 * Lists campaigns with filtering, search, pagination, and tenant-isolated Redis caching.
 */
export async function listCampaigns(params: ListCampaignsParams) {
  const tenantId = params.tenantId || env.DEFAULT_TENANT_ID;
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 10));
  const status = params.status?.trim();
  const channel = params.channel?.trim();
  const search = params.search?.trim();

  const cacheKey = await buildCampaignListCacheKey(tenantId, {
    page,
    limit,
    status: status || 'all',
    channel: channel || 'all',
    search: search || '',
  });

  const cached = await getCachedJson<{
    items: ICampaign[];
    pagination: {
      page: number;
      limit: number;
      totalItems: number;
      totalPages: number;
    };
  }>(cacheKey);

  if (cached) {
    return { ...cached, cached: true };
  }

  const filter: Record<string, unknown> = { tenantId };
  if (status && status !== 'all') {
    filter.status = status;
  }
  if (channel && channel !== 'all') {
    filter.channel = channel;
  }
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { subject: { $regex: escaped, $options: 'i' } },
      { description: { $regex: escaped, $options: 'i' } },
    ];
  }

  const [items, totalItems] = await Promise.all([
    CampaignModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<ICampaign[]>(),
    CampaignModel.countDocuments(filter),
  ]);

  const result = {
    items,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    },
  };

  await setCachedJson(cacheKey, result, env.CACHE_LIST_TTL_SECONDS);
  return { ...result, cached: false };
}

/**
 * Computes and caches dashboard summary KPIs for a tenant.
 */
export async function getDashboardSummary(tenantIdInput?: string) {
  const tenantId = tenantIdInput || env.DEFAULT_TENANT_ID;
  const cacheKey = await buildCampaignSummaryCacheKey(tenantId);

  const cached = await getCachedJson<Record<string, unknown>>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const campaigns = await CampaignModel.find({ tenantId })
    .select('status stats')
    .lean<Pick<ICampaign, 'status' | 'stats'>[]>();

  const statusCounts: Record<CampaignStatus, number> = {
    draft: 0,
    scheduled: 0,
    processing: 0,
    paused: 0,
    completed: 0,
    partially_failed: 0,
    failed: 0,
    cancelled: 0,
  };

  const deliveryTotals = {
    total: 0,
    queued: 0,
    processing: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const c of campaigns) {
    if (statusCounts[c.status] !== undefined) {
      statusCounts[c.status]++;
    }
    deliveryTotals.total += c.stats?.total || 0;
    deliveryTotals.queued += c.stats?.queued || 0;
    deliveryTotals.processing += c.stats?.processing || 0;
    deliveryTotals.succeeded += c.stats?.succeeded || 0;
    deliveryTotals.failed += c.stats?.failed || 0;
    deliveryTotals.skipped += c.stats?.skipped || 0;
  }

  const processedCount = deliveryTotals.succeeded + deliveryTotals.failed;
  const overallSuccessRate =
    processedCount > 0
      ? Number(((deliveryTotals.succeeded / processedCount) * 100).toFixed(2))
      : 100;

  const summary = {
    totalCampaigns: campaigns.length,
    statusCounts,
    deliveryTotals,
    overallSuccessRate,
    generatedAt: new Date().toISOString(),
  };

  await setCachedJson(cacheKey, summary, env.CACHE_SUMMARY_TTL_SECONDS);
  return { ...summary, cached: false };
}

/**
 * Fetches a single campaign by ID with Redis caching.
 */
export async function getCampaignById(tenantIdInput: string, campaignId: string) {
  if (!mongoose.Types.ObjectId.isValid(campaignId)) {
    throw new AppError(400, 'INVALID_CAMPAIGN_ID', 'Invalid campaign ID format.');
  }

  const tenantId = tenantIdInput || env.DEFAULT_TENANT_ID;
  const cacheKey = await buildCampaignDetailCacheKey(tenantId, campaignId);

  const cached = await getCachedJson<ICampaign>(cacheKey);
  if (cached) {
    return { campaign: cached, cached: true };
  }

  const campaign = await CampaignModel.findOne({
    _id: campaignId,
    tenantId,
  }).lean<ICampaign>();

  if (!campaign) {
    throw new AppError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${campaignId} not found.`);
  }

  await setCachedJson(cacheKey, campaign, env.CACHE_DETAIL_TTL_SECONDS);
  return { campaign, cached: false };
}

export interface UpdateCampaignInput {
  name?: string;
  description?: string;
  subject?: string;
  messageTemplate?: string;
  scheduledAt?: string | Date | null;
}

/**
 * Updates a campaign (allowed when in 'draft' or 'scheduled' status) and invalidates cache.
 */
export async function updateCampaign(
  tenantIdInput: string,
  campaignId: string,
  updates: UpdateCampaignInput
): Promise<ICampaign> {
  if (!mongoose.Types.ObjectId.isValid(campaignId)) {
    throw new AppError(400, 'INVALID_CAMPAIGN_ID', 'Invalid campaign ID format.');
  }

  const tenantId = tenantIdInput || env.DEFAULT_TENANT_ID;
  const campaign = await CampaignModel.findOne({ _id: campaignId, tenantId });

  if (!campaign) {
    throw new AppError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${campaignId} not found.`);
  }

  if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
    throw new AppError(
      409,
      'INVALID_STATE_TRANSITION',
      `Cannot edit campaign details while status is '${campaign.status}'.`
    );
  }

  if (updates.name !== undefined) campaign.name = updates.name.trim();
  if (updates.description !== undefined) campaign.description = updates.description.trim();
  if (updates.subject !== undefined) campaign.subject = updates.subject.trim();
  if (updates.messageTemplate !== undefined) campaign.messageTemplate = updates.messageTemplate;

  if (updates.scheduledAt !== undefined) {
    if (updates.scheduledAt === null || updates.scheduledAt === '') {
      campaign.scheduledAt = null;
      if (campaign.status === 'scheduled') {
        campaign.status = 'draft';
      }
    } else {
      const parsed = new Date(updates.scheduledAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError(400, 'INVALID_SCHEDULE_DATE', 'scheduledAt must be a valid date.');
      }
      campaign.scheduledAt = parsed;
      if (campaign.status === 'draft' && parsed.getTime() > Date.now()) {
        campaign.status = 'scheduled';
      }
    }
  }

  await campaign.save();
  await invalidateTenantCampaignCache(tenantId, campaignId);

  await publishCampaignEvent({
    type: 'campaign_updated',
    campaignId,
    tenantId,
    status: campaign.status,
    timestamp: new Date().toISOString(),
  });

  return campaign;
}
