import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const handler = (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } });

/** Tests run hundreds of logins; keep limits effectively off there. */
const scale = env.isTest ? 1000 : 1;

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20 * scale,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler,
});

export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10 * scale,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler,
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300 * scale,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler,
});
