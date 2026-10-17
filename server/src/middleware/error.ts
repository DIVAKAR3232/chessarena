import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, 'Application error');
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these values already exists' } });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
      return;
    }
  }
  // body-parser errors (malformed JSON, payload too large)
  if (typeof err === 'object' && err !== null && 'type' in err && 'status' in err) {
    const e = err as { status: number; type: string };
    if (e.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
      return;
    }
    if (e.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'BAD_REQUEST', message: 'Request body too large' } });
      return;
    }
  }
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Internal server error',
      ...(env.isProduction ? {} : { details: err instanceof Error ? err.message : String(err) }),
    },
  });
}
