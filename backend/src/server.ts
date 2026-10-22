import http from 'http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { closeAllRedisConnections, createRedisClient, getRedisClient } from './config/redis';
import {
  CAMPAIGN_EVENTS_CHANNEL,
  CampaignProgressEvent,
  closeQueues,
  localEventBus,
} from './queues/campaignQueues';
import { invalidateTenantCampaignCache } from './services/cacheService';
import {
  startFallbackProcessorIfRedisOffline,
  stopFallbackProcessor,
} from './services/embeddedWorkerRunner';
import { logger } from './utils/logger';

async function bootstrapServer() {
  try {
    await connectDatabase();
    // Initialize shared Redis client
    getRedisClient();

    // Subscribe to Redis Pub/Sub channel so events emitted by the separate Worker process
    // are forwarded to SSE clients and trigger API cache invalidation
    const subscriber = createRedisClient('redis-pubsub-subscriber', false);
    subscriber.subscribe(CAMPAIGN_EVENTS_CHANNEL).catch((err) => {
      logger.warn({ err: err.message }, 'Failed to subscribe to campaign events channel');
    });
    subscriber.on('message', (channel, message) => {
      if (channel === CAMPAIGN_EVENTS_CHANNEL) {
        try {
          const parsed = JSON.parse(message) as CampaignProgressEvent;
          if (parsed.tenantId) {
            void invalidateTenantCampaignCache(parsed.tenantId, parsed.campaignId);
          }
          localEventBus.emit('campaign_event', parsed);
        } catch {
          // Ignore malformed pubsub payload
        }
      }
    });

    const app = createApp();
    const server = http.createServer(app);

    server.listen(env.PORT, () => {
      logger.info(
        { port: env.PORT, env: env.NODE_ENV },
        `Express API server listening on http://localhost:${env.PORT}`
      );
      startFallbackProcessorIfRedisOffline();
    });

    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down Express API server gracefully...');
      stopFallbackProcessor();
      server.close(async () => {
        await closeQueues();
        await closeAllRedisConnections();
        await disconnectDatabase();
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to start Express API server');
    process.exit(1);
  }
}

if (require.main === module) {
  void bootstrapServer();
}
