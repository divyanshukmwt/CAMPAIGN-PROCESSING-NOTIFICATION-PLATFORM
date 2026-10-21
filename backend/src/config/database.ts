import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

let isListenersAttached = false;

function attachMongoListeners(): void {
  if (isListenersAttached) return;
  isListenersAttached = true;

  mongoose.connection.on('connected', () => {
    logger.info({ uri: maskMongoUri(env.MONGODB_URI) }, 'MongoDB connected');
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected — waiting for automatic reconnection');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected successfully');
  });

  mongoose.connection.on('error', (err) => {
    logger.error({ err: err.message }, 'MongoDB connection error');
  });
}

function maskMongoUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
}

export async function connectDatabase(customUri?: string): Promise<typeof mongoose> {
  attachMongoListeners();

  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  const targetUri = customUri || env.MONGODB_URI;
  await mongoose.connect(targetUri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 25,
  });

  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB connection closed gracefully');
  }
}

export function getDatabaseHealth(): {
  connected: boolean;
  readyState: number;
  stateName: string;
} {
  const states: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  const readyState = mongoose.connection.readyState;
  return {
    connected: readyState === 1,
    readyState,
    stateName: states[readyState] || 'unknown',
  };
}
