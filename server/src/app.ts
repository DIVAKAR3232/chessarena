import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { authenticate } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { apiRouter } from './routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { getSettings } from './modules/settings/settings.service.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: env.SERVE_CLIENT
          ? {
              // Single-host deployment: this server also delivers the SPA.
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              // The chessboard component positions pieces with inline styles.
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'", 'wss:', 'ws:'],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              frameAncestors: ["'none'"],
            }
          : // API only (JSON): a fully locked-down CSP is safe.
            { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin / server-to-server requests have no Origin header.
        if (!origin || env.CLIENT_ORIGIN.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      maxAge: 600,
    }),
  );
  if (!env.isTest) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/health' },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        serializers: {
          req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(healthRouter);

  app.use('/api/v1', noStore, apiLimiter, authenticate, csrfProtection, maintenanceGuard, apiRouter);

  if (env.SERVE_CLIENT) serveClient(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/**
 * Serves the built React app (client/dist) with SPA fallback, so the whole platform runs on one
 * origin: cookies stay first-party and Socket.IO needs no cross-site configuration.
 */
function serveClient(app: express.Express) {
  // Works from both src/ (tsx) and dist/ (compiled): two levels up is the server/ folder's parent.
  const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  const index = path.join(dist, 'index.html');
  if (!existsSync(index)) {
    logger.error({ dist }, 'SERVE_CLIENT is enabled but client/dist/index.html is missing; run the client build');
    return;
  }
  // Hashed assets can be cached forever; index.html must always be revalidated.
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|socket\.io\/|health$|ready$).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  logger.info({ dist }, 'Serving the web client');
}

/** API data is live (ratings, games, notifications): never let browsers or proxies cache it. */
function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** When maintenance mode is on, only admins (and auth/settings endpoints) remain usable. */
async function maintenanceGuard(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/auth') || req.path.startsWith('/public-settings')) return next();
  const settings = await getSettings();
  if (settings.maintenanceMode && req.auth?.user.role !== 'ADMIN') {
    res.status(503).json({ error: { code: 'MAINTENANCE', message: settings.maintenanceMessage } });
    return;
  }
  next();
}
