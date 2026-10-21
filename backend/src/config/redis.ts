import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

let sharedRedisClient: Redis | null = null;
const trackedConnections: Set<Redis> = new Set();

export function getRedisOptions(forBullMQ = false): RedisOptions {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: forBullMQ ? null : 3,
    enableReadyCheck: !forBullMQ,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      logger.warn(
        { attempt: times, nextRetryMs: delay },
        'Redis connection lost — scheduling reconnect attempt'
      );
      return delay;
    },
  };
}

export function createRedisClient(label = 'redis-client', forBullMQ = false): Redis {
  const options = getRedisOptions(forBullMQ);
  const client = env.REDIS_URL
    ? new Redis(env.REDIS_URL, options)
    : new Redis(options);

  trackedConnections.add(client);

  client.on('connect', () => {
    logger.info({ label }, 'Redis client connected');
  });

  client.on('error', (err) => {
    logger.error({ label, err: err.message }, 'Redis client error');
  });

  client.on('close', () => {
    logger.warn({ label }, 'Redis connection closed');
  });

  return client;
}

/**
 * Returns the singleton Redis client used by the API and Worker for
 * caching, rate limiting, provider deduplication, and campaign control flags.
 */
export function getRedisClient(): Redis {
  if (!sharedRedisClient) {
    sharedRedisClient = createRedisClient('shared-app-redis', false);
  }
  return sharedRedisClient;
}

/**
 * BullMQ requires dedicated ioredis connections with maxRetriesPerRequest = null.
 */
export function createBullMQConnection(label = 'bullmq-redis'): Redis {
  return createRedisClient(label, true);
}

/**
 * Allows injecting a custom or mock Redis instance in tests.
 */
export function setRedisClientForTesting(client: Redis): void {
  sharedRedisClient = client;
}

export async function getRedisHealth(): Promise<{
  connected: boolean;
  status: string;
  latencyMs: number | null;
}> {
  try {
    const client = getRedisClient();
    const start = Date.now();
    const pong = await client.ping();
    const latencyMs = Date.now() - start;
    return {
      connected: pong === 'PONG',
      status: client.status,
      latencyMs,
    };
  } catch {
    return {
      connected: false,
      status: sharedRedisClient?.status || 'disconnected',
      latencyMs: null,
    };
  }
}

export async function closeAllRedisConnections(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  for (const conn of trackedConnections) {
    closePromises.push(
      conn
        .quit()
        .then(() => undefined)
        .catch(() => {
          conn.disconnect();
        })
    );
  }
  trackedConnections.clear();
  sharedRedisClient = null;
  await Promise.all(closePromises);
  logger.info('All Redis connections closed gracefully');
}
