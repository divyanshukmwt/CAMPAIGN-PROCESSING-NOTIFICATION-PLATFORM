import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from backend/ or workspace root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DEFAULT_TENANT_ID: z.string().min(1).default('default-tenant'),

  // MongoDB
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/campaign_platform'),

  // Redis
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_URL: z.string().optional(),

  // Worker & Queue
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(10),
  CAMPAIGN_BATCH_SIZE: z.coerce.number().int().min(1).max(5000).default(250),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  DELIVERY_BACKOFF_DELAY_MS: z.coerce.number().int().min(50).default(1000),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),

  // Cache TTLs
  CACHE_LIST_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  CACHE_SUMMARY_TTL_SECONDS: z.coerce.number().int().positive().default(15),
  CACHE_DETAIL_TTL_SECONDS: z.coerce.number().int().positive().default(15),

  // Rate Limiting
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_READ_MAX: z.coerce.number().int().positive().default(180),

  // Mock Notification Provider
  PROVIDER_MIN_LATENCY_MS: z.coerce.number().int().min(0).default(10),
  PROVIDER_MAX_LATENCY_MS: z.coerce.number().int().min(0).default(60),
  PROVIDER_DEFAULT_TRANSIENT_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.05),
  PROVIDER_IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const env: EnvConfig = envSchema.parse(process.env);
