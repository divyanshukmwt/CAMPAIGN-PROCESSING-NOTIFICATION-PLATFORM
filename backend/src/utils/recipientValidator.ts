import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { CampaignChannel, normalizeRecipient } from './idempotency';
import { CampaignValidationReport, ValidationErrorEntry } from '../models/Campaign';

export interface RawRecipientInput {
  recipient?: string;
  email?: string;
  phone?: string;
  address?: string;
  name?: string;
  recipientName?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ValidatedRecipientRecord {
  row: number;
  rawRecipient: string;
  normalizedRecipient: string;
  recipientName: string;
  metadata: Record<string, unknown>;
  isValid: boolean;
  isDuplicate: boolean;
  skipReason?: string;
  failureType?: 'validation' | 'duplicate';
}

export interface RecipientValidationResult {
  validRecipients: ValidatedRecipientRecord[];
  skippedRecipients: ValidatedRecipientRecord[];
  allRecords: ValidatedRecipientRecord[];
  report: CampaignValidationReport;
}

const emailSchema = z
  .string()
  .min(3, 'Email is too short')
  .max(254, 'Email exceeds 254 characters')
  .email('Invalid email format')
  .refine((val) => !val.endsWith('.invalid') && !val.includes('..'), {
    message: 'Reserved or malformed email domain',
  });

const smsSchema = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/, 'Invalid phone number format (expected 7-15 digits, E.164)');

const pushSchema = z
  .string()
  .min(8, 'Push token must be at least 8 characters')
  .max(512, 'Push token exceeds maximum length')
  .regex(/^[A-Za-z0-9_\-:]+$/, 'Push token contains invalid characters');

/**
 * Validates a single normalized recipient string against the channel's Zod schema.
 */
export function validateRecipientAddress(
  channel: CampaignChannel,
  normalized: string
): { valid: boolean; reason?: string } {
  if (!normalized) {
    return { valid: false, reason: 'Recipient address is empty' };
  }

  if (channel === 'email') {
    const res = emailSchema.safeParse(normalized);
    return res.success ? { valid: true } : { valid: false, reason: res.error.issues[0]?.message || 'Invalid email' };
  }

  if (channel === 'sms') {
    const res = smsSchema.safeParse(normalized);
    return res.success ? { valid: true } : { valid: false, reason: res.error.issues[0]?.message || 'Invalid phone number' };
  }

  const res = pushSchema.safeParse(normalized);
  return res.success ? { valid: true } : { valid: false, reason: res.error.issues[0]?.message || 'Invalid push token' };
}

/**
 * Parses a CSV string or Buffer into raw recipient objects.
 * Supports both headered CSVs (e.g., "recipient,name" or "email,name") and single-column headerless CSVs.
 */
export function parseCsvRecipients(csvContent: string | Buffer): RawRecipientInput[] {
  const text = Buffer.isBuffer(csvContent) ? csvContent.toString('utf-8') : csvContent;
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const rows: string[][] = parse(trimmed, {
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  });

  if (rows.length === 0) {
    return [];
  }

  const firstRow = rows[0].map((col) => col.toLowerCase().trim());
  const recipientHeaderKeywords = ['recipient', 'email', 'phone', 'address', 'mobile', 'to', 'token'];
  const hasHeader = firstRow.some((col) => recipientHeaderKeywords.includes(col));

  if (!hasHeader) {
    return rows.map((cols) => ({
      recipient: cols[0] || '',
      name: cols[1] || '',
    }));
  }

  const headers = firstRow;
  const recipientIdx = headers.findIndex((h) => recipientHeaderKeywords.includes(h));
  const nameIdx = headers.findIndex((h) => ['name', 'recipientname', 'full_name', 'fullname'].includes(h));

  return rows.slice(1).map((cols) => {
    const metadata: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (idx !== recipientIdx && idx !== nameIdx && cols[idx] !== undefined && cols[idx] !== '') {
        metadata[h] = cols[idx];
      }
    });

    return {
      recipient: recipientIdx >= 0 ? cols[recipientIdx] || '' : cols[0] || '',
      name: nameIdx >= 0 ? cols[nameIdx] || '' : '',
      metadata,
    };
  });
}

/**
 * Normalizes, validates, and deduplicates a list of recipients (from JSON or parsed CSV).
 */
export function validateAndDeduplicateRecipients(
  channel: CampaignChannel,
  rawInputs: Array<string | RawRecipientInput>
): RecipientValidationResult {
  const seenNormalized = new Set<string>();
  const validRecipients: ValidatedRecipientRecord[] = [];
  const skippedRecipients: ValidatedRecipientRecord[] = [];
  const allRecords: ValidatedRecipientRecord[] = [];
  const errors: ValidationErrorEntry[] = [];

  let invalidCount = 0;
  let duplicateCount = 0;

  rawInputs.forEach((item, index) => {
    const rowNumber = index + 1;
    let rawAddress = '';
    let recipientName = '';
    let metadata: Record<string, unknown> = {};

    if (typeof item === 'string') {
      rawAddress = item;
    } else if (item && typeof item === 'object') {
      rawAddress = String(
        item.recipient ?? item.email ?? item.phone ?? item.address ?? ''
      );
      recipientName = String(item.name ?? item.recipientName ?? '').trim();
      metadata =
        item.metadata && typeof item.metadata === 'object'
          ? (item.metadata as Record<string, unknown>)
          : {};
    }

    const normalized = normalizeRecipient(channel, rawAddress);
    const validation = validateRecipientAddress(channel, normalized);

    if (!validation.valid) {
      invalidCount++;
      const reason = validation.reason || 'Invalid recipient format';
      const record: ValidatedRecipientRecord = {
        row: rowNumber,
        rawRecipient: rawAddress || '(empty)',
        normalizedRecipient: normalized || `(invalid_row_${rowNumber})`,
        recipientName,
        metadata,
        isValid: false,
        isDuplicate: false,
        skipReason: reason,
        failureType: 'validation',
      };
      skippedRecipients.push(record);
      allRecords.push(record);
      if (errors.length < 200) {
        errors.push({
          row: rowNumber,
          recipient: rawAddress || '(empty)',
          reason,
        });
      }
      return;
    }

    if (seenNormalized.has(normalized)) {
      duplicateCount++;
      const reason = 'Duplicate recipient in upload list';
      const record: ValidatedRecipientRecord = {
        row: rowNumber,
        rawRecipient: rawAddress,
        normalizedRecipient: normalized,
        recipientName,
        metadata,
        isValid: false,
        isDuplicate: true,
        skipReason: reason,
        failureType: 'duplicate',
      };
      skippedRecipients.push(record);
      allRecords.push(record);
      if (errors.length < 200) {
        errors.push({
          row: rowNumber,
          recipient: rawAddress,
          reason,
        });
      }
      return;
    }

    seenNormalized.add(normalized);
    const validRecord: ValidatedRecipientRecord = {
      row: rowNumber,
      rawRecipient: rawAddress,
      normalizedRecipient: normalized,
      recipientName,
      metadata,
      isValid: true,
      isDuplicate: false,
    };
    validRecipients.push(validRecord);
    allRecords.push(validRecord);
  });

  return {
    validRecipients,
    skippedRecipients,
    allRecords,
    report: {
      totalSubmitted: rawInputs.length,
      validCount: validRecipients.length,
      invalidCount,
      duplicateCount,
      errors,
    },
  };
}
