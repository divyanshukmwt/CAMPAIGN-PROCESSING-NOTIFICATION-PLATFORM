export type CampaignChannel = 'email' | 'sms' | 'push';

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'partially_failed'
  | 'failed'
  | 'cancelled';

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

export interface Campaign {
  _id: string;
  tenantId: string;
  idempotencyKey?: string;
  name: string;
  description?: string;
  channel: CampaignChannel;
  subject?: string;
  messageTemplate: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  cancelledAt: string | null;
  stats: CampaignStats;
  validationReport: CampaignValidationReport;
  config: CampaignConfig;
  createdAt: string;
  updatedAt: string;
}

export type DeliveryStatus =
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'skipped';

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
  timestamp: string;
  error?: string;
  errorCode?: string;
  durationMs?: number;
  providerMessageId?: string;
  deduplicated?: boolean;
}

export interface Delivery {
  _id: string;
  deliveryId: string;
  campaignId: string;
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
  lastAttemptAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSummary {
  totalCampaigns: number;
  statusCounts: Record<CampaignStatus, number>;
  deliveryTotals: CampaignStats;
  overallSuccessRate: number;
  generatedAt: string;
  cached?: boolean;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'starting';
  timestamp: string;
  uptimeSeconds: number;
  database: {
    connected: boolean;
    readyState: number;
    stateName: string;
  };
  redis: {
    connected: boolean;
    status: string;
    latencyMs: number | null;
  };
  queues: {
    available: boolean;
    dispatchQueue: Record<string, number>;
    deliveryQueue: Record<string, number>;
  };
  workers: {
    activeWorkerCount: number;
    workers: Array<{
      workerId: string;
      concurrency: number;
      startedAt: string;
      lastHeartbeatAt: string;
      processedJobs: number;
      failedJobs: number;
    }>;
  };
  cache: {
    hits: number;
    misses: number;
    invalidations: number;
    hitRate: number;
  };
  provider: {
    totalActualDispatches: number;
    totalDeduplicatedHits: number;
    totalTransientErrors: number;
    totalPermanentErrors: number;
    uniqueRecipientsSent: number;
  };
}

export interface ApiTelemetryMeta {
  lastCacheStatus: 'HIT' | 'MISS' | null;
  rateLimitLimit: number | null;
  rateLimitRemaining: number | null;
  lastIdempotentReplay: boolean;
}
