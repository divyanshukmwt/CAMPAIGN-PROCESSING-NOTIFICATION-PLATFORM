import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { env } from './config/env';
import campaignRoutes from './routes/campaignRoutes';
import healthRoutes from './routes/healthRoutes';
import { AppError } from './services/campaignService';
import { logger } from './utils/logger';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? '*' : [env.CORS_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      exposedHeaders: [
        'X-Cache',
        'X-Idempotent-Replay',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
      ],
    })
  );

  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  // Mount Health & Campaign Routes
  app.use('/api/health', healthRoutes);
  app.use('/api/campaigns', campaignRoutes);

  // 404 Handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    });
  });

  // Centralized Error Handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }

    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        issues: err.issues,
      });
      return;
    }

    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        error: 'MALFORMED_JSON',
        message: 'Invalid JSON payload in request body.',
      });
      return;
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    logger.error({ err: message }, 'Unhandled API error');
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message,
    });
  });

  return app;
}
