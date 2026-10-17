import type { Server } from 'socket.io';
import type { z } from 'zod';
import { logger } from '../config/logger.js';
import { AppError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { resolveSession } from '../middleware/auth.js';
import { isParticipant } from '../policies/index.js';
import * as gameplay from '../modules/matches/gameplay.service.js';
import { getMatchState } from '../modules/matches/match.service.js';
import { drawRespondSchema, matchIdSchema, moveSchema } from '../modules/matches/match.schemas.js';
import { addPresence, removePresence } from '../modules/matches/presence.js';
import { cancelAbandon } from '../modules/matches/timers.js';
import { matchRoom } from '../modules/realtime/emitter.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import type { AppSocket } from './index.js';

type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string; details?: unknown } }) => void;

const RATE = 10; // tokens per second
const BURST = 20;

function takeToken(socket: AppSocket): boolean {
  const b = socket.data.bucket;
  const now = Date.now();
  b.tokens = Math.min(BURST, b.tokens + ((now - b.last) / 1000) * RATE);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function toError(err: unknown) {
  if (err instanceof AppError) return { code: err.code, message: err.message, details: err.details };
  logger.error({ err }, 'Socket handler error');
  return { code: 'INTERNAL', message: 'Internal server error' };
}

export function registerMatchHandlers(io: Server, socket: AppSocket) {
  const user = () => socket.data.auth.user;

  /**
   * Wraps a handler: rate limit, re-validate the session (catches logout/suspension between
   * events), validate the payload, run, and answer through the acknowledgement callback.
   */
  function on<S extends z.ZodType>(
    event: string,
    schema: S,
    handler: (payload: z.output<S>) => Promise<unknown>,
    opts: { mutating?: boolean } = {},
  ) {
    socket.on(
      event,
      (payload: unknown, ack?: unknown) => {
        const reply: Ack = typeof ack === 'function' ? (ack as Ack) : () => {};
        void (async () => {
          if (!takeToken(socket)) {
            reply({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many events' } });
            return;
          }
          try {
            if (opts.mutating) {
              const ctx = await resolveSession(socket.data.auth.user.id, socket.data.auth.sessionId);
              if (!ctx) {
                reply({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Session expired' } });
                socket.disconnect(true);
                return;
              }
              socket.data.auth = ctx;
            }
            const data = await handler(validate(schema, payload));
            reply({ ok: true, data });
          } catch (err) {
            const error = toError(err);
            if (event === 'match:move') socket.emit('match:move:rejected' , { ...error });
            else socket.emit('match:error' , { event, ...error });
            reply({ ok: false, error });
          }
        })();
      },
    );
  }

  on('match:join', matchIdSchema, async ({ matchId }) => {
    // Authorization: getMatchState throws FORBIDDEN unless the user may view this match.
    const state = await getMatchState(user(), matchId);
    await socket.join(matchRoom(matchId));
    socket.data.matches.add(matchId);

    const participant = isParticipant(user(), { whitePlayerId: state.white?.id ?? null, blackPlayerId: state.black?.id ?? null });
    if (participant) {
      const firstSocket = addPresence(matchId, user().id, socket.id);
      cancelAbandon(matchId, user().id);
      if (firstSocket) {
        socket.to(matchRoom(matchId)).emit('match:opponent:connected' , { matchId, userId: user().id });
      }
      if (state.status === 'READY') await gameplay.markJoined(matchId, user().id);
    }
    const fresh = await getMatchState(user(), matchId);
    socket.emit('match:state' , { state: fresh });
    return { state: fresh, role: participant ? 'player' : 'spectator' };
  });

  on('match:leave', matchIdSchema, async ({ matchId }) => {
    await leaveMatch(matchId);
    return null;
  });

  on('match:sync:request', matchIdSchema, async ({ matchId }) => {
    const state = await getMatchState(user(), matchId);
    socket.emit('match:state' , { state });
    return { state };
  });

  on(
    'match:move',
    moveSchema,
    async ({ matchId, from, to, promotion, version }) => {
      const res = await gameplay.makeMove(user(), matchId, { from, to, promotion: promotion ?? null, version });
      return { version: res.version, san: res.move.san };
    },
    { mutating: true },
  );

  on('match:resign', matchIdSchema, async ({ matchId }) => gameplay.resign(user(), matchId).then(() => null), {
    mutating: true,
  });

  on('match:draw:offer', matchIdSchema, async ({ matchId }) => gameplay.offerDraw(user(), matchId).then(() => null), {
    mutating: true,
  });

  on(
    'match:draw:respond',
    drawRespondSchema,
    async ({ matchId, accept }) => gameplay.respondDraw(user(), matchId, accept).then(() => null),
    { mutating: true },
  );

  on('match:draw:claim', matchIdSchema, async ({ matchId }) => gameplay.claimDraw(user(), matchId).then(() => null), {
    mutating: true,
  });

  async function leaveMatch(matchId: string) {
    if (!socket.data.matches.has(matchId)) return;
    socket.data.matches.delete(matchId);
    await socket.leave(matchRoom(matchId));
    const lastSocket = removePresence(matchId, user().id, socket.id);
    if (!lastSocket) return;
    const m = await prisma.match.findUnique({
      where: { id: matchId },
      select: { status: true, whitePlayerId: true, blackPlayerId: true },
    });
    if (!m || !isParticipant(user(), m)) return;
    io.to(matchRoom(matchId)).emit('match:opponent:disconnected', {
      matchId,
      userId: user().id,
      graceMs: m.status === 'IN_PROGRESS' ? env.RECONNECT_GRACE_MS : null,
    });
    if (m.status === 'IN_PROGRESS') gameplay.startAbandonCountdown(matchId, user().id);
  }

  socket.on('disconnect', (reason) => {
    logger.debug({ userId: user().id, reason }, 'Socket disconnected');
    for (const matchId of [...socket.data.matches]) {
      leaveMatch(matchId).catch((err) => logger.error({ err, matchId }, 'Leave on disconnect failed'));
    }
  });
}
