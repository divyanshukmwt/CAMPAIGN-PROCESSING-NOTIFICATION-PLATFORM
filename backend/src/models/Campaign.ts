import mongoose, { Document, Schema } from 'mongoose';
import { CampaignChannel } from '../utils/idempotency';

export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'processing',
  'paused',
  'completed',
  'partially_failed',
  'failed',
  'cancelled',
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface CampaignStats {
  total: number;
  queued: number;
  processing: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface ValidationErrorEntry {
  row: number;
  recipient: string;
  reason: string;
}

export interface CampaignValidationReport {
  totalSubmitted: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  errors: ValidationErrorEntry[];
}

export interface CampaignConfig {
  batchSize: number;
  maxAttempts: number;
  backoffDelayMs: number;
  simulatedTransientFailureRate: number;
  simulatedPermanentFailureRate: number;
}

export interface ICampaign extends Document {
  _id: mongoose.Types.ObjectId;
  tenantId: string;
  idempotencyKey?: string;
  name: string;
  description?: string;
  channel: CampaignChannel;
  subject?: string;
  messageTemplate: string;
  status: CampaignStatus;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  pausedAt: Date | null;
  cancelledAt: Date | null;
  stats: CampaignStats;
  validationReport: CampaignValidationReport;
  config: CampaignConfig;
  createdAt: Date;
  updatedAt: Date;
}

const ValidationErrorSchema = new Schema<ValidationErrorEntry>(
  {
    row: { type: Number, required: true },
    recipient: { type: String, required: true },
    reason: { type: String, required: true },
  },
  { _id: false }
);

const CampaignSchema = new Schema<ICampaign>(
  {
    tenantId: {
      type: String,
      required: true,
      default: 'default-tenant',
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    channel: {
      type: String,
      enum: ['email', 'sms', 'push'],
      required: true,
      default: 'email',
    },
    subject: {
      type: String,
      default: '',
      trim: true,
    },
    messageTemplate: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: CAMPAIGN_STATUSES,
      required: true,
      default: 'draft',
    },
    scheduledAt: {
      type: Date,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    pausedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    stats: {
      total: { type: Number, required: true, default: 0, min: 0 },
      queued: { type: Number, required: true, default: 0, min: 0 },
      processing: { type: Number, required: true, default: 0, min: 0 },
      succeeded: { type: Number, required: true, default: 0, min: 0 },
      failed: { type: Number, required: true, default: 0, min: 0 },
      skipped: { type: Number, required: true, default: 0, min: 0 },
    },
    validationReport: {
      totalSubmitted: { type: Number, required: true, default: 0 },
      validCount: { type: Number, required: true, default: 0 },
      invalidCount: { type: Number, required: true, default: 0 },
      duplicateCount: { type: Number, required: true, default: 0 },
      errors: { type: [ValidationErrorSchema], default: [] },
    },
    config: {
      batchSize: { type: Number, required: true, default: 250 },
      maxAttempts: { type: Number, required: true, default: 4 },
      backoffDelayMs: { type: Number, required: true, default: 1000 },
      simulatedTransientFailureRate: { type: Number, required: true, default: 0.05 },
      simulatedPermanentFailureRate: { type: Number, required: true, default: 0.0 },
    },
  },
  {
    timestamps: true,
  }
);

// 1. Unique compound sparse index for Idempotency-Key deduplication per tenant
CampaignSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    name: 'uniq_tenant_idempotency_key',
  }
);

// 2. Dashboard list filtering & sorting index
CampaignSchema.index(
  { tenantId: 1, status: 1, createdAt: -1 },
  { name: 'idx_tenant_status_created' }
);

// 3. Scheduled campaign lookup index
CampaignSchema.index(
  { status: 1, scheduledAt: 1 },
  { name: 'idx_status_scheduled_at' }
);

export const CampaignModel =
  mongoose.models.Campaign || mongoose.model<ICampaign>('Campaign', CampaignSchema);
