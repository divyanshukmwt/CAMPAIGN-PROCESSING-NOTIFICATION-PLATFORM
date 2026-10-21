import http from 'http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { closeAllRedisConnections, getRedisClient } from './config/redis';
import { closeQueues } from './queues/campaignQueues';
import { logger } from './utils/logger';

async function bootstrapServer() {
  try {
    await connectDatabase();
    // Initialize shared Redis client
    getRedisClient();

    const app = createApp();
    const server = http.createServer(app);

    server.listen(env.PORT, () => {
      logger.info(
        { port: env.PORT, env: env.NODE_ENV },
        `Express API server listening on http://localhost:${env.PORT}`
      );
    });

    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down Express API server gracefully...');
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
