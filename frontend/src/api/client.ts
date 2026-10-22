import {
  ApiTelemetryMeta,
  Campaign,
  CampaignChannel,
  CampaignValidationReport,
  DashboardSummary,
  Delivery,
  SystemHealth,
} from '../types/campaign';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

let currentTenantId = 'default-tenant';
const telemetryListeners = new Set<(meta: ApiTelemetryMeta) => void>();

let latestTelemetry: ApiTelemetryMeta = {
  lastCacheStatus: null,
  rateLimitLimit: null,
  rateLimitRemaining: null,
  lastIdempotentReplay: false,
};

export function getTenantId(): string {
  return currentTenantId;
}

export function setTenantId(tenantId: string): void {
  currentTenantId = tenantId.trim() || 'default-tenant';
}

export function subscribeApiTelemetry(
  cb: (meta: ApiTelemetryMeta) => void
): () => void {
  telemetryListeners.add(cb);
  cb(latestTelemetry);
  return () => telemetryListeners.delete(cb);
}

function captureHeaders(res: Response) {
  const xCache = res.headers.get('X-Cache') as 'HIT' | 'MISS' | null;
  const rlLimit = res.headers.get('X-RateLimit-Limit');
  const rlRem = res.headers.get('X-RateLimit-Remaining');
  const idemp = res.headers.get('X-Idempotent-Replay');

  latestTelemetry = {
    lastCacheStatus: xCache || latestTelemetry.lastCacheStatus,
    rateLimitLimit: rlLimit ? Number(rlLimit) : latestTelemetry.rateLimitLimit,
    rateLimitRemaining: rlRem ? Number(rlRem) : latestTelemetry.rateLimitRemaining,
    lastIdempotentReplay: idemp === 'true',
  };

  telemetryListeners.forEach((cb) => cb(latestTelemetry));
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Tenant-ID', currentTenantId);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  captureHeaders(response);

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(
      data.message || `API Error (${response.status})`
    ) as Error & {
      status?: number;
      code?: string;
      details?: unknown;
      retryAfterSeconds?: number;
    };
    err.status = response.status;
    err.code = data.error;
    err.details = data.details;
    err.retryAfterSeconds = data.retryAfterSeconds;
    throw err;
  }

  return data as T;
}

export async function fetchSystemHealth(): Promise<SystemHealth> {
  return apiRequest<SystemHealth>('/health');
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiRequest<DashboardSummary>('/campaigns/summary');
}

export async function fetchCampaigns(params: {
  page?: number;
  limit?: number;
  status?: string;
  channel?: string;
  search?: string;
}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  if (params.status && params.status !== 'all') q.set('status', params.status);
  if (params.channel && params.channel !== 'all') q.set('channel', params.channel);
  if (params.search) q.set('search', params.search);

  return apiRequest<{
    items: Campaign[];
    pagination: {
      page: number;
      limit: number;
      totalItems: number;
      totalPages: number;
    };
    cached: boolean;
  }>(`/campaigns?${q.toString()}`);
}

export async function fetchCampaignById(campaignId: string) {
  return apiRequest<{ campaign: Campaign; cached: boolean }>(
    `/campaigns/${campaignId}`
  );
}

export async function previewRecipientValidation(params: {
  channel: CampaignChannel;
  csvContent?: string;
  recipients?: Array<string | Record<string, unknown>>;
  file?: File;
}) {
  if (params.file) {
    const fd = new FormData();
    fd.append('channel', params.channel);
    fd.append('file', params.file);
    return apiRequest<{
      report: CampaignValidationReport;
    }>('/campaigns/validate-recipients', {
      method: 'POST',
      body: fd,
    });
  }

  return apiRequest<{
    report: CampaignValidationReport;
  }>('/campaigns/validate-recipients', {
    method: 'POST',
    body: JSON.stringify({
      channel: params.channel,
      csvContent: params.csvContent,
      recipients: params.recipients,
    }),
  });
}

export async function createCampaignRequest(params: {
  idempotencyKey: string;
  name: string;
  description?: string;
  channel: CampaignChannel;
  subject?: string;
  messageTemplate: string;
  recipients?: Array<string | Record<string, unknown>>;
  csvContent?: string;
  file?: File | null;
  scheduledAt?: string | null;
  saveAsDraft?: boolean;
  rejectInvalid?: boolean;
  config?: {
    batchSize?: number;
    maxAttempts?: number;
    backoffDelayMs?: number;
    simulatedTransientFailureRate?: number;
    simulatedPermanentFailureRate?: number;
  };
}) {
  if (params.file) {
    const fd = new FormData();
    fd.append('name', params.name);
    if (params.description) fd.append('description', params.description);
    fd.append('channel', params.channel);
    if (params.subject) fd.append('subject', params.subject);
    fd.append('messageTemplate', params.messageTemplate);
    fd.append('file', params.file);
    if (params.scheduledAt) fd.append('scheduledAt', params.scheduledAt);
    if (params.saveAsDraft) fd.append('saveAsDraft', 'true');
    if (params.rejectInvalid) fd.append('rejectInvalid', 'true');

    return apiRequest<{ campaign: Campaign; idempotentReplay: boolean }>(
      '/campaigns',
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': params.idempotencyKey,
        },
        body: fd,
      }
    );
  }

  return apiRequest<{ campaign: Campaign; idempotentReplay: boolean }>(
    '/campaigns',
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify({
        name: params.name,
        description: params.description,
        channel: params.channel,
        subject: params.subject,
        messageTemplate: params.messageTemplate,
        recipients: params.recipients,
        csvContent: params.csvContent,
        scheduledAt: params.scheduledAt || null,
        saveAsDraft: params.saveAsDraft,
        rejectInvalid: params.rejectInvalid,
        config: params.config,
      }),
    }
  );
}

export async function updateCampaignRequest(
  campaignId: string,
  updates: {
    name?: string;
    description?: string;
    subject?: string;
    messageTemplate?: string;
    scheduledAt?: string | null;
  }
) {
  return apiRequest<{ campaign: Campaign }>(`/campaigns/${campaignId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function triggerCampaignAction(
  campaignId: string,
  action: 'start' | 'pause' | 'resume' | 'cancel'
) {
  return apiRequest<{ campaign: Campaign }>(
    `/campaigns/${campaignId}/${action}`,
    {
      method: 'POST',
    }
  );
}

export async function fetchCampaignDeliveries(params: {
  campaignId: string;
  page?: number;
  limit?: number;
  status?: string;
  failureType?: string;
  search?: string;
}) {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  if (params.status && params.status !== 'all') q.set('status', params.status);
  if (params.failureType && params.failureType !== 'all')
    q.set('failureType', params.failureType);
  if (params.search) q.set('search', params.search);

  return apiRequest<{
    items: Delivery[];
    pagination: {
      page: number;
      limit: number;
      totalItems: number;
      totalPages: number;
    };
  }>(`/campaigns/${params.campaignId}/deliveries?${q.toString()}`);
}

export async function retryCampaignDeliveries(
  campaignId: string,
  deliveryIds?: string[]
) {
  return apiRequest<{
    campaign: Campaign;
    retriedCount: number;
    retriedDeliveryIds: string[];
  }>(`/campaigns/${campaignId}/retry`, {
    method: 'POST',
    body: JSON.stringify({ deliveryIds }),
  });
}

/**
 * Generates a realistic CSV string for testing N recipients (e.g., 100 or 5,000+ recipients)
 * including valid users, transient-retry users, permanent-bounce users, duplicates, and invalid entries.
 */
export function generateMockCsvDataset(
  count: number,
  channel: CampaignChannel
): string {
  const rows: string[] = ['recipient,name,tier'];
  for (let i = 1; i <= count; i++) {
    if (channel === 'email') {
      if (i % 250 === 0) {
        rows.push(`invalid-email-row-${i},Invalid User ${i},free`);
      } else if (i % 200 === 0 && i > 1) {
        rows.push(`user1@example.com,Duplicate User ${i},free`);
      } else if (i % 100 === 0) {
        rows.push(`perm-fail-${i}@example.com,Hard Bounce User ${i},basic`);
      } else if (i % 40 === 0) {
        rows.push(`retry-once-${i}@example.com,Transient Retry User ${i},pro`);
      } else {
        rows.push(`user${i}@example.com,Recipient ${i},enterprise`);
      }
    } else if (channel === 'sms') {
      if (i % 250 === 0) {
        rows.push(`not-a-phone,Invalid Phone ${i},free`);
      } else {
        const padded = String(1000000 + i).slice(-7);
        rows.push(`+1555${padded},SMS User ${i},pro`);
      }
    } else {
      rows.push(`push_token_device_${100000 + i},Push User ${i},pro`);
    }
  }
  return rows.join('\n');
}
