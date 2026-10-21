import pino, { Logger } from 'pino';
import { env } from '../config/env';

export interface LogContext {
  campaignId?: string;
  deliveryId?: string;
  jobId?: string;
  workerId?: string;
  tenantId?: string;
  [key: string]: unknown;
}

export const logger: Logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  base: {
    service: 'campaign-platform',
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

/**
 * Creates a child logger bound with structured context fields
 * such as campaignId, deliveryId, jobId, and workerId.
 */
export function createContextLogger(context: LogContext): Logger {
  return logger.child(context);
}
