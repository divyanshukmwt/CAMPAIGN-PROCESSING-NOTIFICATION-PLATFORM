import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  AppError,
  cancelCampaign,
  createCampaign,
  getCampaignById,
  getDashboardSummary,
  listCampaignDeliveries,
  listCampaigns,
  pauseCampaign,
  resumeCampaign,
  retryFailedDeliveries,
  startCampaign,
  updateCampaign,
} from '../services/campaignService';
import { resolveTenantId } from '../services/cacheService';
import {
  CampaignProgressEvent,
  localEventBus,
} from '../queues/campaignQueues';
import { extractIdempotencyKey } from '../utils/idempotency';
import {
  parseCsvRecipients,
  RawRecipientInput,
  validateAndDeduplicateRecipients,
} from '../utils/recipientValidator';
import { readRateLimiter, writeRateLimiter } from '../middleware/rateLimiter';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max CSV upload
  },
});

const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(200),
  description: z.string().max(1000).optional(),
  channel: z.enum(['email', 'sms', 'push']).default('email'),
  subject: z.string().max(300).optional(),
  messageTemplate: z.string().min(1, 'messageTemplate is required'),
  recipients: z
    .union([
      z.array(
        z.union([
          z.string(),
          z.record(z.unknown()),
        ])
      ),
      z.string(), // JSON string when sent via multipart/form-data
    ])
    .optional(),
  csvContent: z.string().optional(),
  scheduledAt: z.string().nullable().optional(),
  saveAsDraft: z.preprocess(
    (v) => v === 'true' || v === true,
    z.boolean().optional().default(false)
  ),
  rejectInvalid: z.preprocess(
    (v) => v === 'true' || v === true,
    z.boolean().optional().default(false)
  ),
  idempotencyKey: z.string().optional(),
  config: z
    .object({
      batchSize: z.coerce.number().int().min(1).max(5000).optional(),
      maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
      backoffDelayMs: z.coerce.number().int().min(50).optional(),
      simulatedTransientFailureRate: z.coerce.number().min(0).max(1).optional(),
      simulatedPermanentFailureRate: z.coerce.number().min(0).max(1).optional(),
    })
    .optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  subject: z.string().max(300).optional(),
  messageTemplate: z.string().min(1).optional(),
  scheduledAt: z.string().nullable().optional(),
});

/**
 * POST /api/campaigns/validate-recipients
 * Previews recipient validation (valid, invalid with row reasons, duplicates) before creating a campaign.
 */
router.post(
  '/validate-recipients',
  writeRateLimiter,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const channel = (req.body?.channel || 'email') as 'email' | 'sms' | 'push';
      if (!['email', 'sms', 'push'].includes(channel)) {
        throw new AppError(400, 'INVALID_CHANNEL', 'Channel must be email, sms, or push.');
      }

      const rawList: Array<string | RawRecipientInput> = [];

      if (req.file) {
        rawList.push(...parseCsvRecipients(req.file.buffer));
      } else if (typeof req.body?.csvContent === 'string' && req.body.csvContent.trim()) {
        rawList.push(...parseCsvRecipients(req.body.csvContent));
      }

      if (req.body?.recipients) {
        const parsed =
          typeof req.body.recipients === 'string'
            ? JSON.parse(req.body.recipients)
            : req.body.recipients;
        if (Array.isArray(parsed)) {
          rawList.push(...parsed);
        }
      }

      const result = validateAndDeduplicateRecipients(channel, rawList);
      res.status(200).json({
        report: result.report,
        sampleValid: result.validRecipients.slice(0, 20),
        sampleSkipped: result.skippedRecipients.slice(0, 50),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns
 * Creates a campaign from JSON or CSV upload, enforces Idempotency-Key deduplication,
 * persists durable delivery records, and enqueues BullMQ jobs.
 */
router.post(
  '/',
  writeRateLimiter,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedBody = createCampaignSchema.parse(req.body);
      const tenantId = resolveTenantId(req);
      const idempotencyKey = extractIdempotencyKey(
        req.headers['idempotency-key'] || req.headers['x-idempotency-key'],
        parsedBody.idempotencyKey
      );

      let recipientsArray: Array<string | RawRecipientInput> | undefined;
      if (parsedBody.recipients) {
        recipientsArray =
          typeof parsedBody.recipients === 'string'
            ? JSON.parse(parsedBody.recipients)
            : (parsedBody.recipients as Array<string | RawRecipientInput>);
      }

      const csvSource = req.file ? req.file.buffer : parsedBody.csvContent;

      const { campaign, idempotentReplay } = await createCampaign({
        tenantId,
        idempotencyKey,
        name: parsedBody.name,
        description: parsedBody.description,
        channel: parsedBody.channel,
        subject: parsedBody.subject,
        messageTemplate: parsedBody.messageTemplate,
        recipients: recipientsArray,
        csvContent: csvSource,
        scheduledAt: parsedBody.scheduledAt,
        saveAsDraft: parsedBody.saveAsDraft,
        rejectInvalid: parsedBody.rejectInvalid,
        config: parsedBody.config,
      });

      if (idempotentReplay) {
        res.setHeader('X-Idempotent-Replay', 'true');
        res.status(200).json({
          campaign,
          idempotentReplay: true,
        });
        return;
      }

      res.status(201).json({
        campaign,
        idempotentReplay: false,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/campaigns/events
 * Server-Sent Events (SSE) stream for live campaign progress updates (Module 6).
 */
router.get('/events', (req: Request, res: Response) => {
  const tenantId = (
    (req.query.tenantId as string) ||
    resolveTenantId(req)
  ).trim().toLowerCase();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(
    `data: ${JSON.stringify({
      type: 'connected',
      tenantId,
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  const onEvent = (event: CampaignProgressEvent) => {
    if (!event.tenantId || event.tenantId.toLowerCase() === tenantId) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  localEventBus.on('campaign_event', onEvent);

  const keepAliveTimer = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);
  keepAliveTimer.unref();

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    localEventBus.off('campaign_event', onEvent);
  });
});

/**
 * GET /api/campaigns/summary
 * Returns cached dashboard summary KPIs for the current tenant.
 */
router.get(
  '/summary',
  readRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req);
      const summary = await getDashboardSummary(tenantId);
      res.setHeader('X-Cache', summary.cached ? 'HIT' : 'MISS');
      res.status(200).json(summary);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/campaigns
 * Lists campaigns with search, status/channel filters, pagination, and Redis caching.
 */
router.get(
  '/',
  readRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req);
      const result = await listCampaigns({
        tenantId,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 10,
        status: req.query.status as string | undefined,
        channel: req.query.channel as string | undefined,
        search: req.query.search as string | undefined,
      });

      res.setHeader('X-Cache', result.cached ? 'HIT' : 'MISS');
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/campaigns/:id
 * Returns a single campaign by ID with Redis caching.
 */
router.get(
  '/:id',
  readRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req);
      const result = await getCampaignById(tenantId, req.params.id);
      res.setHeader('X-Cache', result.cached ? 'HIT' : 'MISS');
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/campaigns/:id
 * Updates a campaign (draft/scheduled/paused) and invalidates tenant cache.
 */
router.patch(
  '/:id',
  writeRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req);
      const updates = updateCampaignSchema.parse(req.body);
      const campaign = await updateCampaign(tenantId, req.params.id, updates);
      res.status(200).json({ campaign });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/:id/start
 * Launches a draft or scheduled campaign immediately.
 */
router.post(
  '/:id/start',
  writeRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req);
      const campaign = await startCampaign(tenantId, req.params.id);
      res.status(200).json({ campaign });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/:id/pause
 * Pauses a processing or scheduled campaign.
 */
router.post(
  '/:id/pause',
  writeRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req);
      const campaign = await pauseCampaign(tenantId, req.params.id);
      res.status(200).json({ campaign });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/:id/resume
 * Resumes a paused campaign and re-dispatches remaining queued deliveries.
 */
router.post(
  '/:id/resume',
  writeRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req);
      const campaign = await resumeCampaign(tenantId, req.params.id);
      res.status(200).json({ campaign });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/:id/cancel
 * Cancels a campaign before completion and marks remaining queued deliveries as skipped.
 */
router.post(
  '/:id/cancel',
  writeRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req);
      const campaign = await cancelCampaign(tenantId, req.params.id);
      res.status(200).json({ campaign });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/campaigns/:id/deliveries
 * Paginated inspection of campaign deliveries (filterable by status=failed/skipped/succeeded, failureType, search).
 */
router.get(
  '/:id/deliveries',
  readRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req);
      const result = await listCampaignDeliveries({
        tenantId,
        campaignId: req.params.id,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 25,
        status: req.query.status as string | undefined,
        failureType: req.query.failureType as string | undefined,
        search: req.query.search as string | undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

const retryDeliveriesSchema = z.object({
  deliveryIds: z.array(z.string()).optional(),
});

/**
 * POST /api/campaigns/:id/retry
 * Manually reprocesses failed deliveries (all failed or selected deliveryIds).
 */
router.post(
  '/:id/retry',
  writeRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = resolveTenantId(req);
      const parsed = retryDeliveriesSchema.parse(req.body || {});
      const result = await retryFailedDeliveries({
        tenantId,
        campaignId: req.params.id,
        deliveryIds: parsed.deliveryIds,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
