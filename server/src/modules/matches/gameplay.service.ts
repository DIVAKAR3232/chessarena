/**
 * Server-authoritative gameplay: starting games, moves, clocks, draws, resignation, timeouts,
 * abandonment and exactly-once result finalization.
 *
 * Every state change runs in a PostgreSQL transaction that first takes a per-match advisory lock,
 * then re-reads the match, so concurrent requests (two sockets, HTTP + socket, timers) are
 * serialized. `positionVersion` additionally rejects stale client submissions.
 */
import type { Match, MatchResult, PlayerColor, TerminationReason } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError, forbidden, invalidState, notFound } from '../../lib/errors.js';
import { advisoryLock, prisma, type Tx } from '../../lib/prisma.js';
import type { Actor } from '../../policies/index.js';
import { audit } from '../audit/audit.service.js';
import { GameEngine, IllegalMoveError, opposite, type Color, type MoveInput } from '../chess/engine.js';
import { notify } from '../notifications/notification.service.js';
import { applyRatings } from '../ratings/rating.service.js';
import { emitToMatch, emitToUser } from '../realtime/emitter.js';
import { anchorTurn, clearAnchor, elapsedInTurn } from './clock.js';
import { runFinalizeHooks } from './hooks.js';
import { assertTransition } from './lifecycle.js';
import { loadMatch, toMatchState } from './match.view.js';
import { isPresent } from './presence.js';
import { cancelAbandon, cancelFlag, scheduleAbandon, scheduleFlag } from './timers.js';

// ---------------------------------------------------------------------------------------------
// Engine cache: replaying moves is cheap, but avoid it on every move of a live game.
// ---------------------------------------------------------------------------------------------
const engineCache = new Map<string, { version: number; engine: GameEngine }>();

async function getEngine(tx: Tx, m: Pick<Match, 'id' | 'initialFen' | 'positionVersion'>): Promise<GameEngine> {
  const cached = engineCache.get(m.id);
  if (cached && cached.version === m.positionVersion) return cached.engine;
  const moves = await tx.gameMove.findMany({
    where: { matchId: m.id },
    orderBy: { ply: 'asc' },
    select: { fromSquare: true, toSquare: true, promotion: true },
  });
  const engine = GameEngine.fromMoves(
    m.initialFen,
    moves.map((mv) => ({ from: mv.fromSquare, to: mv.toSquare, promotion: (mv.promotion as MoveInput['promotion']) ?? null })),
  );
  engineCache.set(m.id, { version: m.positionVersion, engine });
  return engine;
}

const colorOf = (m: Pick<Match, 'whitePlayerId' | 'blackPlayerId'>, userId: string): Color | null =>
  m.whitePlayerId === userId ? 'w' : m.blackPlayerId === userId ? 'b' : null;

const toPlayerColor = (c: Color): PlayerColor => (c === 'w' ? 'WHITE' : 'BLACK');
const fromPlayerColor = (c: PlayerColor): Color => (c === 'WHITE' ? 'w' : 'b');

// ---------------------------------------------------------------------------------------------
// Transaction wrapper
// ---------------------------------------------------------------------------------------------
interface TxContext {
  tx: Tx;
  match: Match;
  after: (() => void)[];
}

async function withMatchLock<T>(matchId: string, fn: (ctx: TxContext) => Promise<T>): Promise<T> {
  const after: (() => void)[] = [];
  let result: T;
  try {
    result = await prisma.$transaction(
      async (tx) => {
        await advisoryLock(tx, `match:${matchId}`);
        const match = await tx.match.findUnique({ where: { id: matchId } });
        if (!match) throw notFound('Match');
        return fn({ tx, match, after });
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  } catch (err) {
    // The cached engine may have advanced past what was committed.
    engineCache.delete(matchId);
    throw err;
  }
  for (const cb of after) {
    try {
      cb();
    } catch (err) {
      logger.error({ err, matchId }, 'Post-commit callback failed');
    }
  }
  return result;
}

/** Re-loads the match and broadcasts the authoritative state to its room. */
export async function broadcastState(matchId: string, event = 'match:state', extra: Record<string, unknown> = {}) {
  const m = await loadMatch(matchId);
  if (!m) return null;
  const state = await stateWithClaims(m);
  emitToMatch(matchId, event, { ...extra, state });
  return state;
}

export async function stateWithClaims(m: NonNullable<Awaited<ReturnType<typeof loadMatch>>>) {
  let claimableDraw: string | null = null;
  if (m.status === 'IN_PROGRESS') {
    try {
      claimableDraw = (await getEngine(prisma, m)).claimableDraw();
    } catch (err) {
      logger.error({ err, matchId: m.id }, 'Failed to rebuild engine');
    }
  }
  return toMatchState(m, { claimableDraw });
}

function scheduleClock(m: Pick<Match, 'id' | 'status' | 'currentTurn' | 'whiteTimeRemainingMs' | 'blackTimeRemainingMs' | 'positionVersion' | 'turnStartedAt'>) {
  if (m.status !== 'IN_PROGRESS') {
    cancelFlag(m.id);
    return;
  }
  const remaining = m.currentTurn === 'WHITE' ? m.whiteTimeRemainingMs : m.blackTimeRemainingMs;
  const elapsed = elapsedInTurn(m.id, m.positionVersion, m.turnStartedAt);
  scheduleFlag(m.id, remaining - elapsed, () => {
    checkTimeout(m.id).catch((err) => logger.error({ err, matchId: m.id }, 'Timeout check failed'));
  });
}

// ---------------------------------------------------------------------------------------------
// Finalization (exactly once)
// ---------------------------------------------------------------------------------------------
interface Outcome {
  result: MatchResult;
  reason: TerminationReason;
  /** ABANDONED for abandonment, COMPLETED otherwise. */
  status?: 'COMPLETED' | 'ABANDONED';
  /** Override rating behaviour (e.g. abandoned before any real play). */
  rated?: boolean;
  clocks?: { white: number; black: number };
}

const RESULT_TOKEN: Record<MatchResult, string> = {
  WHITE_WIN: '1-0',
  BLACK_WIN: '0-1',
  DRAW: '1/2-1/2',
  NO_RESULT: '*',
};

async function finalize(ctx: TxContext, outcome: Outcome): Promise<boolean> {
  const { tx, match } = ctx;
  const status = outcome.status ?? 'COMPLETED';
  assertTransition(match.status, status);
  const winnerId =
    outcome.result === 'WHITE_WIN' ? match.whitePlayerId : outcome.result === 'BLACK_WIN' ? match.blackPlayerId : null;

  const engine = await getEngine(tx, match);
  const names = await tx.user.findMany({
    where: { id: { in: [match.whitePlayerId, match.blackPlayerId].filter((x): x is string => Boolean(x)) } },
    select: { id: true, username: true },
  });
  const nameOf = (id: string | null) => names.find((n) => n.id === id)?.username ?? '?';
  const pgn = engine.pgn({
    Event: 'ChessArena game',
    Site: 'ChessArena',
    Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    White: nameOf(match.whitePlayerId),
    Black: nameOf(match.blackPlayerId),
    Result: RESULT_TOKEN[outcome.result],
    Termination: outcome.reason,
  });

  // The status predicate makes finalization idempotent under any concurrency.
  const updated = await tx.match.updateMany({
    where: { id: match.id, status: 'IN_PROGRESS', positionVersion: match.positionVersion },
    data: {
      status,
      result: outcome.result,
      terminationReason: outcome.reason,
      winnerId,
      completedAt: new Date(),
      pgn,
      positionVersion: { increment: 1 },
      ...(outcome.rated === false ? { rated: false } : {}),
      ...(outcome.clocks
        ? { whiteTimeRemainingMs: outcome.clocks.white, blackTimeRemainingMs: outcome.clocks.black }
        : {}),
      turnStartedAt: null,
    },
  });
  if (updated.count !== 1) return false;

  await tx.drawOffer.updateMany({
    where: { matchId: match.id, status: 'PENDING' },
    data: { status: 'EXPIRED', respondedAt: new Date() },
  });

  const rated = outcome.rated ?? match.rated;
  let ratingChange = null;
  if (rated && match.whitePlayerId && match.blackPlayerId && outcome.result !== 'NO_RESULT') {
    ratingChange = await applyRatings(tx, {
      id: match.id,
      whitePlayerId: match.whitePlayerId,
      blackPlayerId: match.blackPlayerId,
      result: outcome.result,
    });
  }

  await audit(
    {
      actorId: null,
      action: 'match.finalized',
      resourceType: 'match',
      resourceId: match.id,
      details: { result: outcome.result, reason: outcome.reason, status, rated },
    },
    tx,
  );

  const label = outcome.result === 'DRAW' ? 'Draw' : outcome.result === 'NO_RESULT' ? 'No result' : 'Game over';
  const recipients = [match.whitePlayerId, match.blackPlayerId].filter((x): x is string => Boolean(x));
  const { publish } = await notify(
    recipients.map((r) => ({
      recipientId: r,
      type: 'MATCH_RESULT' as const,
      title: `${label}: ${RESULT_TOKEN[outcome.result]}`,
      message: `Your game ended (${outcome.reason.toLowerCase().replace(/_/g, ' ')}).${
        r === winnerId ? ' You won!' : ''
      }`,
      relatedMatchId: match.id,
    })),
    tx,
  );

  const hookCallbacks = await runFinalizeHooks(tx, {
    id: match.id,
    status,
    result: outcome.result,
    tournamentId: match.tournamentId,
    roundId: match.roundId,
    whitePlayerId: match.whitePlayerId,
    blackPlayerId: match.blackPlayerId,
    winnerId,
  });

  ctx.after.push(() => {
    cancelFlag(match.id);
    clearAnchor(match.id);
    engineCache.delete(match.id);
    if (match.whitePlayerId) cancelAbandon(match.id, match.whitePlayerId);
    if (match.blackPlayerId) cancelAbandon(match.id, match.blackPlayerId);
    publish();
    for (const cb of hookCallbacks) cb();
    logger.info({ matchId: match.id, result: outcome.result, reason: outcome.reason }, 'Match finalized');
    void broadcastState(match.id, 'match:result', { ratingChange });
  });
  return true;
}

/** Outcome when `flagged` runs out of time (draw if the opponent cannot possibly mate). */
function timeoutOutcome(engine: GameEngine, flagged: Color): Outcome {
  const opponent = opposite(flagged);
  if (!engine.hasMatingMaterial(opponent)) {
    return { result: 'DRAW', reason: 'TIMEOUT_VS_INSUFFICIENT_MATERIAL' };
  }
  return { result: opponent === 'w' ? 'WHITE_WIN' : 'BLACK_WIN', reason: 'TIMEOUT' };
}

// ---------------------------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------------------------

/**
 * Records that a participant opened the board. When both have joined a READY match whose
 * scheduled time has arrived, the game starts and White's clock begins.
 */
export async function markJoined(matchId: string, userId: string) {
  return withMatchLock(matchId, async (ctx) => {
    const { tx, match } = ctx;
    const color = colorOf(match, userId);
    if (!color) return match.status;
    if (match.status !== 'READY') return match.status;

    const field = color === 'w' ? 'whiteJoinedAt' : 'blackJoinedAt';
    const now = new Date();
    if (!match[field]) {
      await tx.match.update({ where: { id: matchId }, data: { [field]: now } });
      match[field] = now;
    }
    if (!match.whiteJoinedAt || !match.blackJoinedAt) return match.status;
    if (match.scheduledAt && match.scheduledAt > now) return match.status;

    // One live game per player at a time.
    const busy = await tx.match.count({
      where: {
        id: { not: matchId },
        status: 'IN_PROGRESS',
        OR: [
          { whitePlayerId: { in: [match.whitePlayerId!, match.blackPlayerId!] } },
          { blackPlayerId: { in: [match.whitePlayerId!, match.blackPlayerId!] } },
        ],
      },
    });
    if (busy > 0) return match.status;

    assertTransition(match.status, 'IN_PROGRESS');
    const engine = await getEngine(tx, match);
    const started = await tx.match.update({
      where: { id: matchId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: now,
        turnStartedAt: now,
        currentTurn: toPlayerColor(engine.turn),
        positionVersion: { increment: 1 },
      },
    });
    engineCache.set(matchId, { version: started.positionVersion, engine });
    await audit({ actorId: null, action: 'match.started', resourceType: 'match', resourceId: matchId }, tx);
    ctx.after.push(() => {
      anchorTurn(matchId, started.positionVersion);
      scheduleClock(started);
      logger.info({ matchId }, 'Match started');
      void broadcastState(matchId);
    });
    return started.status;
  });
}

// ---------------------------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------------------------
export interface MoveRequest extends MoveInput {
  /** The position version the client based this move on. */
  version: number;
}

export async function makeMove(actor: Actor, matchId: string, req: MoveRequest) {
  const outcome = await withMatchLock(matchId, async (ctx) => {
    const { tx, match } = ctx;
    const color = actor.role === 'PLAYER' ? colorOf(match, actor.id) : null;
    if (!color) throw forbidden('Only the players of this match can make moves');
    if (match.status !== 'IN_PROGRESS') throw invalidState('The game is not in progress');
    if (fromPlayerColor(match.currentTurn) !== color) throw new AppError('NOT_YOUR_TURN', 'It is not your turn');
    if (req.version !== match.positionVersion) {
      throw new AppError('STALE_POSITION', 'Your board is out of date; please resync', {
        expected: match.positionVersion,
      });
    }

    // Clock: if the mover's flag has already fallen, the move is too late.
    const now = new Date();
    const elapsed = elapsedInTurn(matchId, match.positionVersion, match.turnStartedAt, now.getTime());
    const remainingBefore = (color === 'w' ? match.whiteTimeRemainingMs : match.blackTimeRemainingMs) - elapsed;
    const engine = await getEngine(tx, match);
    if (remainingBefore <= 0) {
      const clocks =
        color === 'w'
          ? { white: 0, black: match.blackTimeRemainingMs }
          : { white: match.whiteTimeRemainingMs, black: 0 };
      await finalize(ctx, { ...timeoutOutcome(engine, color), clocks });
      return { kind: 'timeout' as const };
    }

    let applied;
    try {
      applied = engine.applyMove({ from: req.from, to: req.to, promotion: req.promotion ?? null });
    } catch (err) {
      if (err instanceof IllegalMoveError) throw new AppError('ILLEGAL_MOVE', err.message);
      throw err;
    }

    const remainingAfter = remainingBefore + match.incrementMs;
    const clocks =
      color === 'w'
        ? { whiteTimeRemainingMs: remainingAfter, blackTimeRemainingMs: match.blackTimeRemainingMs }
        : { whiteTimeRemainingMs: match.whiteTimeRemainingMs, blackTimeRemainingMs: remainingAfter };

    await tx.gameMove.create({
      data: {
        matchId,
        ply: engine.ply,
        playerId: actor.id,
        fromSquare: applied.from,
        toSquare: applied.to,
        promotion: applied.promotion,
        san: applied.san,
        fenAfter: applied.fenAfter,
        clockAfterMs: remainingAfter,
        elapsedMs: elapsed,
      },
    });
    const updated = await tx.match.updateMany({
      where: { id: matchId, positionVersion: match.positionVersion, status: 'IN_PROGRESS' },
      data: {
        currentFen: applied.fenAfter,
        pgn: engine.pgn(),
        currentTurn: toPlayerColor(engine.turn),
        ...clocks,
        turnStartedAt: now,
        positionVersion: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new AppError('STALE_POSITION', 'Your board is out of date; please resync');

    // A move implicitly declines any draw offer made by the opponent.
    await tx.drawOffer.updateMany({
      where: { matchId, status: 'PENDING', offeredByPlayerId: { not: actor.id } },
      data: { status: 'DECLINED', respondedAt: now },
    });

    const newVersion = match.positionVersion + 1;
    engineCache.set(matchId, { version: newVersion, engine });
    const afterMove: Match = {
      ...match,
      ...clocks,
      currentFen: applied.fenAfter,
      currentTurn: toPlayerColor(engine.turn),
      turnStartedAt: now,
      positionVersion: newVersion,
    };

    const termination = engine.terminationStatus();
    if (termination) {
      ctx.match = afterMove;
      await finalize(ctx, {
        result: termination.winner === null ? 'DRAW' : termination.winner === 'w' ? 'WHITE_WIN' : 'BLACK_WIN',
        reason: termination.reason,
      });
    } else {
      ctx.after.push(() => {
        anchorTurn(matchId, newVersion);
        scheduleClock(afterMove);
      });
    }
    return {
      kind: 'moved' as const,
      move: { ...applied, ply: engine.ply },
      version: newVersion,
      terminated: Boolean(termination),
    };
  });

  if (outcome.kind === 'moved') {
    const state = await broadcastState(matchId, 'match:move:accepted', { move: outcome.move });
    if (state) emitToMatch(matchId, 'match:clock:update', { version: state.version, clocks: state.clocks, serverTime: state.serverTime });
    return { ...outcome, state };
  }
  throw new AppError('INVALID_STATE', 'Your time ran out before the move arrived');
}

// ---------------------------------------------------------------------------------------------
// Resignation, draws
// ---------------------------------------------------------------------------------------------
function requireParticipantInProgress(actor: Actor, match: Match): Color {
  const color = actor.role === 'PLAYER' ? colorOf(match, actor.id) : null;
  if (!color) throw forbidden('Only the players of this match can do this');
  if (match.status !== 'IN_PROGRESS') throw invalidState('The game is not in progress');
  return color;
}

export async function resign(actor: Actor, matchId: string) {
  await withMatchLock(matchId, async (ctx) => {
    const color = requireParticipantInProgress(actor, ctx.match);
    const ok = await finalize(ctx, {
      result: color === 'w' ? 'BLACK_WIN' : 'WHITE_WIN',
      reason: 'RESIGNATION',
      clocks: currentClocks(ctx.match),
    });
    if (!ok) throw invalidState('The game has already ended');
  });
}

function currentClocks(m: Match) {
  const elapsed = elapsedInTurn(m.id, m.positionVersion, m.turnStartedAt);
  return m.currentTurn === 'WHITE'
    ? { white: Math.max(0, m.whiteTimeRemainingMs - elapsed), black: m.blackTimeRemainingMs }
    : { white: m.whiteTimeRemainingMs, black: Math.max(0, m.blackTimeRemainingMs - elapsed) };
}

export async function offerDraw(actor: Actor, matchId: string) {
  const offer = await withMatchLock(matchId, async (ctx) => {
    const { tx, match } = ctx;
    requireParticipantInProgress(actor, match);
    const engine = await getEngine(tx, match);
    const pending = await tx.drawOffer.findFirst({ where: { matchId, status: 'PENDING' } });
    if (pending) {
      if (pending.offeredByPlayerId === actor.id) throw invalidState('You already have a pending draw offer');
      throw invalidState('Your opponent has offered a draw; accept or decline it instead');
    }
    // Anti-spam: at most one offer per player per position.
    const recent = await tx.drawOffer.findFirst({ where: { matchId, offeredByPlayerId: actor.id, ply: engine.ply } });
    if (recent) throw invalidState('You already offered a draw in this position');
    const created = await tx.drawOffer.create({ data: { matchId, offeredByPlayerId: actor.id, ply: engine.ply } });
    const opponentId = match.whitePlayerId === actor.id ? match.blackPlayerId : match.whitePlayerId;
    ctx.after.push(() => {
      emitToMatch(matchId, 'match:draw:offered', { matchId, offeredBy: actor.id, ply: created.ply });
      if (opponentId) emitToUser(opponentId, 'notification:toast', { type: 'DRAW_OFFER', matchId });
    });
    return created;
  });
  await broadcastState(matchId);
  return offer;
}

export async function respondDraw(actor: Actor, matchId: string, accept: boolean) {
  await withMatchLock(matchId, async (ctx) => {
    const { tx, match } = ctx;
    requireParticipantInProgress(actor, match);
    const pending = await tx.drawOffer.findFirst({
      where: { matchId, status: 'PENDING', offeredByPlayerId: { not: actor.id } },
    });
    if (!pending) throw invalidState('There is no draw offer to respond to');
    await tx.drawOffer.update({
      where: { id: pending.id },
      data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date() },
    });
    if (accept) {
      await finalize(ctx, { result: 'DRAW', reason: 'DRAW_AGREEMENT', clocks: currentClocks(match) });
    } else {
      ctx.after.push(() => {
        emitToMatch(matchId, 'match:draw:declined', { matchId, declinedBy: actor.id });
        void broadcastState(matchId);
      });
    }
  });
}

/** Claims a draw by threefold repetition or the fifty-move rule when the position allows it. */
export async function claimDraw(actor: Actor, matchId: string) {
  await withMatchLock(matchId, async (ctx) => {
    const { tx, match } = ctx;
    requireParticipantInProgress(actor, match);
    const engine = await getEngine(tx, match);
    const claim = engine.claimableDraw();
    if (!claim) throw invalidState('No draw can be claimed in this position');
    await finalize(ctx, { result: 'DRAW', reason: claim, clocks: currentClocks(match) });
  });
}

// ---------------------------------------------------------------------------------------------
// Timeouts and abandonment
// ---------------------------------------------------------------------------------------------

/** Called by the deadline timer (and on boot). Finalizes only if the flag really fell. */
export async function checkTimeout(matchId: string) {
  let reschedule: Match | null = null;
  await withMatchLock(matchId, async (ctx) => {
    const { tx, match } = ctx;
    if (match.status !== 'IN_PROGRESS') return;
    const elapsed = elapsedInTurn(matchId, match.positionVersion, match.turnStartedAt);
    const mover = fromPlayerColor(match.currentTurn);
    const remaining = (mover === 'w' ? match.whiteTimeRemainingMs : match.blackTimeRemainingMs) - elapsed;
    if (remaining > 0) {
      reschedule = match;
      return;
    }
    const engine = await getEngine(tx, match);
    const clocks =
      mover === 'w' ? { white: 0, black: match.blackTimeRemainingMs } : { white: match.whiteTimeRemainingMs, black: 0 };
    await finalize(ctx, { ...timeoutOutcome(engine, mover), clocks });
  });
  if (reschedule) scheduleClock(reschedule);
}

/** Starts the reconnection grace period for a participant whose last socket left the match. */
export function startAbandonCountdown(matchId: string, userId: string) {
  scheduleAbandon(matchId, userId, env.RECONNECT_GRACE_MS, () => {
    handleAbandon(matchId, userId).catch((err) => logger.error({ err, matchId }, 'Abandon check failed'));
  });
}

export async function handleAbandon(matchId: string, absentUserId: string) {
  if (isPresent(matchId, absentUserId)) return;
  await withMatchLock(matchId, async (ctx) => {
    const { tx, match } = ctx;
    if (match.status !== 'IN_PROGRESS') return;
    const absentColor = colorOf(match, absentUserId);
    if (!absentColor) return;
    const opponentId = absentColor === 'w' ? match.blackPlayerId : match.whitePlayerId;
    // If both players are gone, let the clock decide instead.
    if (!isPresent(matchId, opponentId)) return;
    const plies = await tx.gameMove.count({ where: { matchId } });
    if (plies < 2) {
      await finalize(ctx, { result: 'NO_RESULT', reason: 'ABANDONMENT', status: 'ABANDONED', rated: false, clocks: currentClocks(match) });
    } else {
      await finalize(ctx, {
        result: absentColor === 'w' ? 'BLACK_WIN' : 'WHITE_WIN',
        reason: 'ABANDONMENT',
        status: 'ABANDONED',
        clocks: currentClocks(match),
      });
    }
  });
}

/** Re-arms deadline timers for all live games after a restart. */
export async function rescheduleLiveMatches() {
  const live = await prisma.match.findMany({ where: { status: 'IN_PROGRESS' } });
  for (const m of live) scheduleClock(m);
  return live.length;
}

/** Test/maintenance helper. */
export function resetGameplayCaches() {
  engineCache.clear();
}
