import mongoose from 'mongoose';
import { env } from '../config/env';
import {
  CampaignModel,
  CampaignStatus,
  ICampaign,
} from '../models/Campaign';
import { DeliveryModel, IDelivery } from '../models/Delivery';
import {
  buildCampaignDetailCacheKey,
  buildCampaignListCacheKey,
  buildCampaignSummaryCacheKey,
  getCachedJson,
  invalidateTenantCampaignCache,
  setCachedJson,
} from './cacheService';
import { clearWorkerCampaignMetaCache } from './deliveryProcessor';
import { clearProviderIdempotencyKey } from './mockProvider';
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

/**
 * Starts a draft or scheduled campaign immediately.
 */
export async function startCampaign(
  tenantIdInput: string,
  campaignId: string,
  skipQueueEnqueue = false
): Promise<ICampaign> {
  if (!mongoose.Types.ObjectId.isValid(campaignId)) {
    throw new AppError(400, 'INVALID_CAMPAIGN_ID', 'Invalid campaign ID format.');
  }

  const tenantId = tenantIdInput || env.DEFAULT_TENANT_ID;
  const campaign = await CampaignModel.findOne({ _id: campaignId, tenantId });

  if (!campaign) {
    throw new AppError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${campaignId} not found.`);
  }

  if (!['draft', 'scheduled'].includes(campaign.status)) {
    throw new AppError(
      409,
      'INVALID_STATE_TRANSITION',
      `Cannot start campaign from status '${campaign.status}'.`
    );
  }

  campaign.status = 'processing';
  campaign.startedAt = new Date();
  await campaign.save();

  clearWorkerCampaignMetaCache(campaignId);
  await setCampaignRuntimeState(campaignId, 'processing');
  await invalidateTenantCampaignCache(tenantId, campaignId);

  if (!skipQueueEnqueue) {
    try {
      await enqueueCampaignDispatchJob({
        campaignId,
        tenantId,
        batchSize: campaign.config.batchSize,
        triggeredBy: 'start',
      });
    } catch (err) {
      logger.warn({ campaignId, err: (err as Error).message }, 'Dispatch enqueue warning on start');
    }
  }

  await publishCampaignEvent({
    type: 'campaign_updated',
    campaignId,
    tenantId,
    status: 'processing',
    timestamp: new Date().toISOString(),
  });

  return campaign;
}

/**
 * Pauses an active ('processing' or 'scheduled') campaign.
 * Workers check the Redis runtime state before each delivery and defer remaining queued items.
 */
export async function pauseCampaign(
  tenantIdInput: string,
  campaignId: string
): Promise<ICampaign> {
  if (!mongoose.Types.ObjectId.isValid(campaignId)) {
    throw new AppError(400, 'INVALID_CAMPAIGN_ID', 'Invalid campaign ID format.');
  }

  const tenantId = tenantIdInput || env.DEFAULT_TENANT_ID;
  const campaign = await CampaignModel.findOne({ _id: campaignId, tenantId });

  if (!campaign) {
    throw new AppError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${campaignId} not found.`);
  }

  if (!['processing', 'scheduled'].includes(campaign.status)) {
    throw new AppError(
      409,
      'INVALID_STATE_TRANSITION',
      `Cannot pause campaign when status is '${campaign.status}'.`
    );
  }

  campaign.status = 'paused';
  campaign.pausedAt = new Date();
  await campaign.save();

  clearWorkerCampaignMetaCache(campaignId);
  await setCampaignRuntimeState(campaignId, 'paused');
  await invalidateTenantCampaignCache(tenantId, campaignId);

  await publishCampaignEvent({
    type: 'campaign_updated',
    campaignId,
    tenantId,
    status: 'paused',
    timestamp: new Date().toISOString(),
  });

  return campaign;
}

/**
 * Resumes a paused campaign and re-dispatches all remaining queued deliveries.
 */
export async function resumeCampaign(
  tenantIdInput: string,
  campaignId: string,
  skipQueueEnqueue = false
): Promise<ICampaign> {
  if (!mongoose.Types.ObjectId.isValid(campaignId)) {
    throw new AppError(400, 'INVALID_CAMPAIGN_ID', 'Invalid campaign ID format.');
  }

  const tenantId = tenantIdInput || env.DEFAULT_TENANT_ID;
  const campaign = await CampaignModel.findOne({ _id: campaignId, tenantId });

  if (!campaign) {
    throw new AppError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${campaignId} not found.`);
  }

  if (campaign.status !== 'paused') {
    throw new AppError(
      409,
      'INVALID_STATE_TRANSITION',
      `Cannot resume campaign when status is '${campaign.status}'.`
    );
  }

  campaign.status = 'processing';
  campaign.pausedAt = null;
  if (!campaign.startedAt) {
    campaign.startedAt = new Date();
  }
  await campaign.save();

  clearWorkerCampaignMetaCache(campaignId);
  await setCampaignRuntimeState(campaignId, 'processing');
  await invalidateTenantCampaignCache(tenantId, campaignId);

  if (!skipQueueEnqueue) {
    try {
      await enqueueCampaignDispatchJob({
        campaignId,
        tenantId,
        batchSize: campaign.config.batchSize,
        triggeredBy: 'resume',
      });
    } catch (err) {
      logger.warn({ campaignId, err: (err as Error).message }, 'Dispatch enqueue warning on resume');
    }
  }

  await publishCampaignEvent({
    type: 'campaign_updated',
    campaignId,
    tenantId,
    status: 'processing',
    timestamp: new Date().toISOString(),
  });

  return campaign;
}

/**
 * Cancels a campaign before completion, marking all remaining queued deliveries as 'skipped'
 * with failureType = 'cancelled' and updating campaign statistics accurately.
 */
export async function cancelCampaign(
  tenantIdInput: string,
  campaignId: string
): Promise<ICampaign> {
  if (!mongoose.Types.ObjectId.isValid(campaignId)) {
    throw new AppError(400, 'INVALID_CAMPAIGN_ID', 'Invalid campaign ID format.');
  }

  const tenantId = tenantIdInput || env.DEFAULT_TENANT_ID;
  const campaign = await CampaignModel.findOne({ _id: campaignId, tenantId });

  if (!campaign) {
    throw new AppError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${campaignId} not found.`);
  }

  if (['completed', 'partially_failed', 'failed', 'cancelled'].includes(campaign.status)) {
    throw new AppError(
      409,
      'INVALID_STATE_TRANSITION',
      `Cannot cancel campaign that is already '${campaign.status}'.`
    );
  }

  // 1. Immediately set Redis state to 'cancelled' so workers stop picking up deliveries
  await setCampaignRuntimeState(campaignId, 'cancelled');
  clearWorkerCampaignMetaCache(campaignId);

  // 2. Bulk transition all remaining 'queued' deliveries to 'skipped'
  const updateResult = await DeliveryModel.updateMany(
    {
      campaignId: campaign._id,
      status: 'queued',
    },
    {
      $set: {
        status: 'skipped',
        failureType: 'cancelled',
        lastError: 'Campaign cancelled by administrator before delivery',
        errorCode: 'CAMPAIGN_CANCELLED',
        completedAt: new Date(),
      },
    }
  );

  const cancelledCount = updateResult.modifiedCount || 0;

  // 3. Atomically update campaign status and counters
  const updatedCampaign = await CampaignModel.findOneAndUpdate(
    { _id: campaign._id },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
        completedAt: new Date(),
      },
      $inc: {
        'stats.queued': -cancelledCount,
        'stats.skipped': cancelledCount,
      },
    },
    { new: true }
  );

  const finalDoc = updatedCampaign || campaign;
  await invalidateTenantCampaignCache(tenantId, campaignId);

  await publishCampaignEvent({
    type: 'campaign_updated',
    campaignId,
    tenantId,
    status: 'cancelled',
    timestamp: new Date().toISOString(),
  });

  return finalDoc;
}

export interface ListDeliveriesParams {
  tenantId: string;
  campaignId: string;
  page?: number;
  limit?: number;
  status?: string;
  failureType?: string;
  search?: string;
}

/**
 * Lists deliveries for a campaign with filtering by status ('failed', 'skipped', 'succeeded', etc.),
 * failureType ('permanent', 'transient', etc.), recipient search, and pagination (Modules 2, 5 & 6).
 */
export async function listCampaignDeliveries(params: ListDeliveriesParams) {
  if (!mongoose.Types.ObjectId.isValid(params.campaignId)) {
    throw new AppError(400, 'INVALID_CAMPAIGN_ID', 'Invalid campaign ID format.');
  }

  const tenantId = params.tenantId || env.DEFAULT_TENANT_ID;
  const campaignExists = await CampaignModel.exists({
    _id: params.campaignId,
    tenantId,
  });

  if (!campaignExists) {
    throw new AppError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${params.campaignId} not found.`);
  }

  const page = Math.max(1, params.page || 1);
  const limit = Math.min(200, Math.max(1, params.limit || 25));

  const filter: Record<string, unknown> = {
    campaignId: new mongoose.Types.ObjectId(params.campaignId),
  };

  if (params.status && params.status !== 'all') {
    filter.status = params.status;
  }

  if (params.failureType && params.failureType !== 'all') {
    filter.failureType = params.failureType;
  }

  if (params.search && params.search.trim()) {
    const escaped = params.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { recipient: { $regex: escaped, $options: 'i' } },
      { recipientName: { $regex: escaped, $options: 'i' } },
      { deliveryId: { $regex: escaped, $options: 'i' } },
      { lastError: { $regex: escaped, $options: 'i' } },
    ];
  }

  const [items, totalItems] = await Promise.all([
    DeliveryModel.find(filter)
      .sort({ updatedAt: -1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<IDelivery[]>(),
    DeliveryModel.countDocuments(filter),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    },
  };
}

export interface RetryDeliveriesInput {
  tenantId: string;
  campaignId: string;
  deliveryIds?: string[];
  OverrideRecipientSimulateFailureToNull?: boolean;
  skipQueueEnqueue?: boolean;
}

/**
 * Manually reprocesses permanently or transiently failed deliveries (selected deliveryIds or all failed)
 * without double-counting campaign statistics (Modules 2, 5 & 6).
 */
export async function retryFailedDeliveries(input: RetryDeliveriesInput): Promise<{
  campaign: ICampaign;
  retriedCount: number;
  retriedDeliveryIds: string[];
}> {
  if (!mongoose.Types.ObjectId.isValid(input.campaignId)) {
    throw new AppError(400, 'INVALID_CAMPAIGN_ID', 'Invalid campaign ID format.');
  }

  const tenantId = input.tenantId || env.DEFAULT_TENANT_ID;
  const campaign = await CampaignModel.findOne({
    _id: input.campaignId,
    tenantId,
  });

  if (!campaign) {
    throw new AppError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${input.campaignId} not found.`);
  }

  const deliveryQuery: Record<string, unknown> = {
    campaignId: campaign._id,
    status: 'failed',
  };

  if (Array.isArray(input.deliveryIds) && input.deliveryIds.length > 0) {
    deliveryQuery.deliveryId = { $in: input.deliveryIds };
  }

  const failedDocs = await DeliveryModel.find(deliveryQuery)
    .select('_id deliveryId attemptsMade maxAttempts')
    .lean();

  if (failedDocs.length === 0) {
    return {
      campaign,
      retriedCount: 0,
      retriedDeliveryIds: [],
    };
  }

  const targetIds = failedDocs.map((d) => d.deliveryId);

  // Clear provider idempotency cache for these deliveries so manual reprocess executes fresh
  await Promise.all(targetIds.map((id) => clearProviderIdempotencyKey(id)));

  // Atomically transition matched deliveries from 'failed' -> 'queued' and grant fresh attempts
  const updateResult = await DeliveryModel.updateMany(
    {
      campaignId: campaign._id,
      deliveryId: { $in: targetIds },
      status: 'failed',
    },
    {
      $set: {
        status: 'queued',
        failureType: null,
        lastError: null,
        errorCode: null,
        completedAt: null,
      },
      $inc: {
        maxAttempts: campaign.config.maxAttempts || 4,
      },
    }
  );

  const retriedCount = updateResult.modifiedCount || 0;

  if (retriedCount > 0) {
    const updatedCampaign = await CampaignModel.findOneAndUpdate(
      { _id: campaign._id },
      {
        $set: {
          status: 'processing',
          completedAt: null,
        },
        $inc: {
          'stats.failed': -retriedCount,
          'stats.queued': retriedCount,
        },
      },
      { new: true }
    );

    if (updatedCampaign) {
      campaign.status = updatedCampaign.status;
      campaign.stats = updatedCampaign.stats;
    }

    clearWorkerCampaignMetaCache(input.campaignId);
    await setCampaignRuntimeState(input.campaignId, 'processing');
    await invalidateTenantCampaignCache(tenantId, input.campaignId);

    if (!input.skipQueueEnqueue) {
      try {
        await enqueueCampaignDispatchJob({
          campaignId: input.campaignId,
          tenantId,
          batchSize: campaign.config.batchSize,
          triggeredBy: 'retry',
        });
      } catch (err) {
        logger.warn(
          { campaignId: input.campaignId, err: (err as Error).message },
          'Dispatch enqueue warning on retry'
        );
      }
    }

    await publishCampaignEvent({
      type: 'campaign_updated',
      campaignId: input.campaignId,
      tenantId,
      status: 'processing',
      timestamp: new Date().toISOString(),
    });
  }

  return {
    campaign,
    retriedCount,
    retriedDeliveryIds: targetIds.slice(0, retriedCount),
  };
}
