import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { playerCardSelect, toPlayerCard } from '../users/user.mapper.js';
import { liveClocks } from './clock.js';
import { isPresent } from './presence.js';

export const matchInclude = {
  whitePlayer: { select: playerCardSelect },
  blackPlayer: { select: playerCardSelect },
  coordinator: { select: { id: true, username: true, displayName: true } },
  tournament: { select: { id: true, name: true, format: true } },
  round: { select: { id: true, roundNumber: true } },
  moves: {
    orderBy: { ply: 'asc' },
    select: { ply: true, san: true, fromSquare: true, toSquare: true, promotion: true, clockAfterMs: true, elapsedMs: true, fenAfter: true },
  },
  drawOffers: { where: { status: 'PENDING' }, select: { id: true, offeredByPlayerId: true, ply: true, createdAt: true } },
} satisfies Prisma.MatchInclude;

export type MatchWithRelations = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;

/** Public match state shared by everyone in the match room (no private user data). */
export function toMatchState(m: MatchWithRelations, extras: { claimableDraw?: string | null } = {}) {
  const clocks = liveClocks(m);
  return {
    id: m.id,
    status: m.status,
    result: m.result,
    terminationReason: m.terminationReason,
    winnerId: m.winnerId,
    source: m.source,
    rated: m.rated,
    isPrivate: m.isPrivate,
    initialTimeMs: m.initialTimeMs,
    incrementMs: m.incrementMs,
    initialFen: m.initialFen,
    fen: m.currentFen,
    pgn: m.pgn,
    turn: m.currentTurn === 'WHITE' ? 'w' : 'b',
    version: m.positionVersion,
    white: toPlayerCard(m.whitePlayer),
    black: toPlayerCard(m.blackPlayer),
    whiteConnected: isPresent(m.id, m.whitePlayerId),
    blackConnected: isPresent(m.id, m.blackPlayerId),
    clocks: { white: clocks.whiteMs, black: clocks.blackMs, running: clocks.running },
    serverTime: Date.now(),
    moves: m.moves.map((mv) => ({
      ply: mv.ply,
      san: mv.san,
      from: mv.fromSquare,
      to: mv.toSquare,
      promotion: mv.promotion,
      clockAfterMs: mv.clockAfterMs,
      elapsedMs: mv.elapsedMs,
      fenAfter: mv.fenAfter,
    })),
    drawOffer: m.drawOffers[0]
      ? { offeredBy: m.drawOffers[0].offeredByPlayerId, ply: m.drawOffers[0].ply }
      : null,
    claimableDraw: extras.claimableDraw ?? null,
    tournament: m.tournament,
    round: m.round,
    coordinator: m.coordinator,
    scheduledAt: m.scheduledAt,
    startedAt: m.startedAt,
    completedAt: m.completedAt,
    createdAt: m.createdAt,
    createdById: m.createdById,
    cancelReason: m.cancelReason,
    whiteJoined: Boolean(m.whiteJoinedAt),
    blackJoined: Boolean(m.blackJoinedAt),
  };
}

export type MatchState = ReturnType<typeof toMatchState>;

export async function loadMatch(id: string, tx: Tx = prisma): Promise<MatchWithRelations | null> {
  return tx.match.findUnique({ where: { id }, include: matchInclude });
}

/** Compact row for lists (no moves). */
export const matchListSelect = {
  id: true,
  status: true,
  result: true,
  terminationReason: true,
  winnerId: true,
  source: true,
  rated: true,
  isPrivate: true,
  initialTimeMs: true,
  incrementMs: true,
  scheduledAt: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  createdById: true,
  positionVersion: true,
  whitePlayer: { select: playerCardSelect },
  blackPlayer: { select: playerCardSelect },
  tournament: { select: { id: true, name: true } },
  round: { select: { roundNumber: true } },
  coordinator: { select: { id: true, displayName: true } },
} satisfies Prisma.MatchSelect;

export type MatchListRow = Prisma.MatchGetPayload<{ select: typeof matchListSelect }>;

export function toMatchListItem(m: MatchListRow) {
  return {
    ...m,
    white: toPlayerCard(m.whitePlayer),
    black: toPlayerCard(m.blackPlayer),
    whitePlayer: undefined,
    blackPlayer: undefined,
  };
}
