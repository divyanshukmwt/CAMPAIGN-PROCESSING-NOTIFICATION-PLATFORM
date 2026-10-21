import mongoose, { Document, Schema } from 'mongoose';
import { CampaignChannel } from '../utils/idempotency';

export const DELIVERY_STATUSES = [
  'queued',
  'processing',
  'succeeded',
  'failed',
  'skipped',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type DeliveryFailureType =
  | 'transient'
  | 'permanent'
  | 'validation'
  | 'duplicate'
  | 'cancelled'
  | null;

export interface DeliveryAttemptEntry {
  attempt: number;
  status: 'succeeded' | 'failed_transient' | 'failed_permanent';
  timestamp: Date;
  error?: string;
  errorCode?: string;
  durationMs?: number;
  providerMessageId?: string;
  deduplicated?: boolean;
}

export interface IDelivery extends Document {
  _id: mongoose.Types.ObjectId;
  deliveryId: string;
  campaignId: mongoose.Types.ObjectId;
  tenantId: string;
  channel: CampaignChannel;
  recipient: string;
  rawRecipient: string;
  recipientName?: string;
  metadata?: Record<string, unknown>;
  status: DeliveryStatus;
  failureType: DeliveryFailureType;
  lastError: string | null;
  errorCode: string | null;
  attemptsMade: number;
  maxAttempts: number;
  providerMessageId: string | null;
  jobId: string | null;
  attemptHistory: DeliveryAttemptEntry[];
  lastAttemptAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const DeliveryAttemptSchema = new Schema<DeliveryAttemptEntry>(
  {
    attempt: { type: Number, required: true },
    status: {
      type: String,
      enum: ['succeeded', 'failed_transient', 'failed_permanent'],
      required: true,
    },
    timestamp: { type: Date, required: true, default: Date.now },
    error: { type: String },
    errorCode: { type: String },
    durationMs: { type: Number },
    providerMessageId: { type: String },
    deduplicated: { type: Boolean, default: false },
  },
  { _id: false }
);

const DeliverySchema = new Schema<IDelivery>(
  {
    deliveryId: {
      type: String,
      required: true,
      unique: true,
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    tenantId: {
      type: String,
      required: true,
      default: 'default-tenant',
    },
    channel: {
      type: String,
      enum: ['email', 'sms', 'push'],
      required: true,
    },
    recipient: {
      type: String,
      required: true,
    },
    rawRecipient: {
      type: String,
      required: true,
    },
    recipientName: {
      type: String,
      default: '',
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: DELIVERY_STATUSES,
      required: true,
      default: 'queued',
    },
    failureType: {
      type: String,
      enum: ['transient', 'permanent', 'validation', 'duplicate', 'cancelled', null],
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    errorCode: {
      type: String,
      default: null,
    },
    attemptsMade: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      required: true,
      default: 4,
      min: 1,
    },
    providerMessageId: {
      type: String,
      default: null,
    },
    jobId: {
      type: String,
      default: null,
    },
    attemptHistory: {
      type: [DeliveryAttemptSchema],
      default: [],
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// 1. Unique compound index guaranteeing one delivery record per (campaignId, normalized recipient)
// Partial filter allows storing multiple invalid/duplicate 'skipped' rows for audit if needed while strictly enforcing uniqueness for active/valid recipients
DeliverySchema.index(
  { campaignId: 1, recipient: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['queued', 'processing', 'succeeded', 'failed'] } },
    name: 'uniq_campaign_recipient',
  }
);

// 2. Index for batch streaming queued deliveries and paginated failed-recipient inspection
DeliverySchema.index(
  { campaignId: 1, status: 1, _id: 1 },
  { name: 'idx_campaign_status_cursor' }
);

export const DeliveryModel =
  mongoose.models.Delivery || mongoose.model<IDelivery>('Delivery', DeliverySchema);
