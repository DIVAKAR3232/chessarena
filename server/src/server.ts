import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './lib/prisma.js';
import { startBackgroundJobs, stopBackgroundJobs } from './jobs.js';
import { createSocketServer } from './socket/index.js';

async function main() {
  await prisma.$connect();
  const app = createApp();
  const httpServer = createServer(app);
  const io = createSocketServer(httpServer);
  await startBackgroundJobs();

  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, origins: env.CLIENT_ORIGIN }, 'ChessArena API listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    stopBackgroundJobs();
    // Close Socket.IO (disconnects clients; they reconnect to the next instance) then HTTP.
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  // Force-exit if graceful shutdown hangs.
  process.on('SIGTERM', () => setTimeout(() => process.exit(1), 10_000).unref());
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
