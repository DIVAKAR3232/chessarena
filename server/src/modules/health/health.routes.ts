import { Router } from 'express';
import { logger } from '../../config/logger.js';
import { prisma } from '../../lib/prisma.js';

export const healthRouter = Router();

/** Liveness: the process is up and serving requests. */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

/** Readiness: required dependencies (PostgreSQL) are reachable. No diagnostic details leak. */
healthRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', database: 'ok' });
  } catch (err) {
    logger.error({ err }, 'Readiness check failed');
    res.status(503).json({ status: 'unavailable', database: 'error' });
  }
});
