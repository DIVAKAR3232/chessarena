import type { Server as HttpServer } from 'node:http';
import { Server, type DefaultEventsMap, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { resolveSession, type AuthContext } from '../middleware/auth.js';
import { verifySocketTicket } from '../modules/auth/tokens.js';
import { setIo, userRoom } from '../modules/realtime/emitter.js';
import { registerMatchHandlers } from './match.handlers.js';

export interface SocketData {
  auth: AuthContext;
  /** Match rooms this socket joined. */
  matches: Set<string>;
  bucket: { tokens: number; last: number };
}

export type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    connectionStateRecovery: undefined,
    // Reject cross-site WebSocket hijacking attempts before the handshake completes.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin || env.CLIENT_ORIGIN.includes(origin.replace(/\/$/, ''))) return cb(null, true);
      logger.warn({ origin }, 'Socket connection rejected: origin not allowed');
      cb('origin not allowed', false);
    },
  });

  io.use(async (socket, next) => {
    try {
      const ticket = (socket.handshake.auth as { ticket?: unknown } | undefined)?.ticket;
      const claims = typeof ticket === 'string' ? verifySocketTicket(ticket) : null;
      const ctx = claims ? await resolveSession(claims.userId, claims.sessionId) : null;
      if (!ctx) {
        logger.warn({ ip: socket.handshake.address }, 'Socket authentication failed');
        return next(new Error('UNAUTHENTICATED'));
      }
      socket.data.auth = ctx;
      socket.data.matches = new Set();
      socket.data.bucket = { tokens: 20, last: Date.now() };
      next();
    } catch (err) {
      logger.error({ err }, 'Socket auth error');
      next(new Error('INTERNAL'));
    }
  });

  io.on('connection', (socket) => {
    const s = socket as unknown as AppSocket;
    void s.join(userRoom(s.data.auth.user.id));
    logger.debug({ userId: s.data.auth.user.id, socketId: s.id }, 'Socket connected');
    registerMatchHandlers(io, s);
  });

  setIo(io);
  return io;
}

/** Disconnects every socket of a user (e.g. after suspension or logout-everywhere). */
export function disconnectUser(io: Server | null, userId: string) {
  io?.in(userRoom(userId)).disconnectSockets(true);
}
