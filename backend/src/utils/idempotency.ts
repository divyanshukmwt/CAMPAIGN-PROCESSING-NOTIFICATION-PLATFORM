import crypto from 'crypto';

export type CampaignChannel = 'email' | 'sms' | 'push';

/**
 * Normalizes a recipient address based on the campaign channel so that
 * "Alice@Example.com " and "alice@example.com" map to the exact same recipient.
 */
export function normalizeRecipient(channel: CampaignChannel, rawRecipient: string): string {
  const trimmed = (rawRecipient || '').trim();
  if (channel === 'email') {
    return trimmed.toLowerCase();
  }
  if (channel === 'sms') {
    // Preserve leading '+' and digits only
    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');
    return hasPlus ? `+${digits}` : digits;
  }
  return trimmed;
}

/**
 * Generates a deterministic, collision-resistant Delivery ID for a (campaignId, channel, recipient) tuple.
 * Calling this function multiple times for the same campaign and recipient always produces the exact same ID.
 */
export function generateDeliveryId(
  campaignId: string,
  channel: CampaignChannel,
  rawRecipient: string
): string {
  const normalized = normalizeRecipient(channel, rawRecipient);
  const hash = crypto
    .createHash('sha256')
    .update(`${campaignId.trim()}:${channel}:${normalized}`)
    .digest('hex');
  return `del_${hash.slice(0, 40)}`;
}

/**
 * Extracts and sanitizes an Idempotency-Key from HTTP request headers or body.
 */
export function extractIdempotencyKey(
  headerValue?: string | string[] | null,
  bodyValue?: string | null
): string | undefined {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue || bodyValue;
  if (!raw || typeof raw !== 'string') {
    return undefined;
  }
  const cleaned = raw.trim();
  return cleaned.length > 0 ? cleaned.slice(0, 128) : undefined;
}
