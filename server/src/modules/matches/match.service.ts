/**
 * Match management: challenges, invitations, open seats, coordinator-assigned matches,
 * cancellation, listing and matchmaking. Gameplay itself lives in gameplay.service.ts.
 */
import type { Match, MatchSource, Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { badRequest, conflict, forbidden, invalidState, notFound } from '../../lib/errors.js';
import { pageMeta, toSkipTake, type Pagination } from '../../lib/pagination.js';
import { advisoryLock, prisma, type Tx } from '../../lib/prisma.js';
import {
  assertCanManageTournament,
  assertCanViewMatch,
  canCancelMatch,
  canSuperviseMatch,
  type Actor,
} from '../../policies/index.js';
import { audit } from '../audit/audit.service.js';
import { GameEngine, STANDARD_FEN } from '../chess/engine.js';
import { isAllowedTimeControl, type TimeControl } from '../chess/timeControls.js';
import { notify } from '../notifications/notification.service.js';
import { emitToUser } from '../realtime/emitter.js';
import { getSettings } from '../settings/settings.service.js';
import { broadcastState, stateWithClaims } from './gameplay.service.js';
import { assertTransition, PRE_START_STATUSES } from './lifecycle.js';
import { loadMatch, matchListSelect, toMatchListItem } from './match.view.js';

const MAX_PENDING_CHALLENGES = 5;

async function assertTimeControl(tc: TimeControl) {
  const settings = await getSettings();
  if (!isAllowedTimeControl(tc, settings)) {
    throw badRequest('This time control is not allowed');
  }
}

async function assertActivePlayer(userId: string, tx: Tx = prisma, label = 'Player') {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { role: true, accountStatus: true } });
  if (!u || u.role !== 'PLAYER') throw notFound(label);
  if (u.accountStatus !== 'ACTIVE') throw badRequest(`${label} account is not active`);
}

function resolveColors(creatorId: string, opponentId: string | null, color: 'white' | 'black' | 'random') {
  const creatorWhite = color === 'white' || (color === 'random' && Math.random() < 0.5);
  return creatorWhite
    ? { whitePlayerId: creatorId, blackPlayerId: opponentId }
    : { whitePlayerId: opponentId, blackPlayerId: creatorId };
}

function clockFields(tc: TimeControl) {
  return {
    initialTimeMs: tc.initialTimeMs,
    incrementMs: tc.incrementMs,
    whiteTimeRemainingMs: tc.initialTimeMs,
    blackTimeRemainingMs: tc.initialTimeMs,
    initialFen: STANDARD_FEN,
    currentFen: STANDARD_FEN,
  };
}

const invitationExpiry = () => new Date(Date.now() + env.INVITATION_TTL_MINUTES * 60_000);

// ---------------------------------------------------------------------------------------------
// Player challenges
// ---------------------------------------------------------------------------------------------
export async function createChallenge(
  actor: Actor,
  input: TimeControl & { opponentId?: string; color: 'white' | 'black' | 'random'; rated: boolean; isPrivate: boolean },
) {
  if (actor.role !== 'PLAYER') throw forbidden('Only players can create challenges');
  await assertTimeControl(input);
  if (input.opponentId === actor.id) throw badRequest('You cannot challenge yourself');
  if (input.isPrivate && !input.opponentId) throw badRequest('A private challenge needs an invited opponent');

  const match = await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `player:${actor.id}`);
    const pending = await tx.match.count({
      where: { createdById: actor.id, status: { in: ['CREATED', 'WAITING'] } },
    });
    if (pending >= MAX_PENDING_CHALLENGES) {
      throw conflict(`You can have at most ${MAX_PENDING_CHALLENGES} pending challenges`);
    }
    if (input.opponentId) await assertActivePlayer(input.opponentId, tx, 'Opponent');

    const seats = resolveColors(actor.id, input.opponentId ?? null, input.color);
    const match = await tx.match.create({
      data: {
        ...seats,
        ...clockFields(input),
        createdById: actor.id,
        source: 'CHALLENGE',
        status: input.opponentId ? 'WAITING' : 'CREATED',
        rated: input.rated,
        isPrivate: input.isPrivate,
      },
    });
    let publish = () => {};
    if (input.opponentId) {
      await tx.matchInvitation.create({
        data: { matchId: match.id, inviterId: actor.id, inviteeId: input.opponentId, expiresAt: invitationExpiry() },
      });
      ({ publish } = await notify(
        [
          {
            recipientId: input.opponentId,
            type: 'MATCH_INVITATION',
            title: 'New challenge',
            message: `${actor.displayName ?? 'A player'} challenged you to a game.`,
            relatedMatchId: match.id,
          },
        ],
        tx,
      ));
    }
    return { match, publish };
  });
  match.publish();
  return match.match;
}

/** Takes the empty seat of an open public challenge. */
export async function joinOpenMatch(actor: Actor, matchId: string) {
  if (actor.role !== 'PLAYER') throw forbidden('Only players can join games');
  const { match, publish } = await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `match:${matchId}`);
    const m = await tx.match.findUnique({ where: { id: matchId } });
    if (!m) throw notFound('Match');
    if (m.status !== 'CREATED' || m.isPrivate) throw invalidState('This game is not open for joining');
    if (m.createdById === actor.id || m.whitePlayerId === actor.id || m.blackPlayerId === actor.id) {
      throw badRequest('You cannot join your own challenge');
    }
    assertTransition(m.status, 'READY');
    const seat = m.whitePlayerId ? { blackPlayerId: actor.id } : { whitePlayerId: actor.id };
    const updated = await tx.match.update({ where: { id: matchId }, data: { ...seat, status: 'READY' } });
    const { publish } = await notify(
      [
        {
          recipientId: m.createdById,
          type: 'MATCH_ASSIGNED',
          title: 'Challenge accepted',
          message: `${actor.displayName ?? 'A player'} accepted your open challenge.`,
          relatedMatchId: matchId,
        },
      ],
      tx,
    );
    return { match: updated, publish };
  });
  publish();
  emitToUser(match.createdById, 'match:ready', { matchId });
  return match;
}

/** Invites a specific player into the empty seat of the creator's open challenge. */
export async function inviteToMatch(actor: Actor, matchId: string, inviteeId: string) {
  if (inviteeId === actor.id) throw badRequest('You cannot invite yourself');
  const { publish, match } = await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `match:${matchId}`);
    const m = await tx.match.findUnique({ where: { id: matchId } });
    if (!m) throw notFound('Match');
    if (m.createdById !== actor.id) throw forbidden('Only the creator can invite to this game');
    if (m.status !== 'CREATED') throw invalidState('This game already has an opponent');
    await assertActivePlayer(inviteeId, tx, 'Invitee');
    assertTransition(m.status, 'WAITING');
    const seat = m.whitePlayerId ? { blackPlayerId: inviteeId } : { whitePlayerId: inviteeId };
    const match = await tx.match.update({ where: { id: matchId }, data: { ...seat, status: 'WAITING' } });
    await tx.matchInvitation.create({
      data: { matchId, inviterId: actor.id, inviteeId, expiresAt: invitationExpiry() },
    });
    const { publish } = await notify(
      [{ recipientId: inviteeId, type: 'MATCH_INVITATION', title: 'New challenge', message: 'You have been invited to a game.', relatedMatchId: matchId }],
      tx,
    );
    return { publish, match };
  });
  publish();
  return match;
}

export async function respondToInvitation(actor: Actor, invitationId: string, accept: boolean) {
  const inv = await prisma.matchInvitation.findUnique({ where: { id: invitationId } });
  if (!inv || inv.inviteeId !== actor.id) throw notFound('Invitation');
  const { match, publish } = await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `match:${inv.matchId}`);
    const fresh = await tx.matchInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    if (fresh.status !== 'PENDING') throw invalidState('This invitation is no longer pending');
    const m = await tx.match.findUniqueOrThrow({ where: { id: inv.matchId } });
    if (fresh.expiresAt < new Date()) {
      await expireInvitation(tx, fresh.id, m);
      throw invalidState('This invitation has expired');
    }
    await tx.matchInvitation.update({
      where: { id: invitationId },
      data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date() },
    });
    let match: Match;
    if (accept) {
      assertTransition(m.status, 'READY');
      match = await tx.match.update({ where: { id: m.id }, data: { status: 'READY' } });
    } else {
      assertTransition(m.status, 'CANCELLED');
      match = await tx.match.update({
        where: { id: m.id },
        data: { status: 'CANCELLED', cancelReason: 'Invitation declined', terminationReason: 'CANCELLED' },
      });
    }
    const { publish } = await notify(
      [
        {
          recipientId: inv.inviterId,
          type: 'MATCH_INVITATION',
          title: accept ? 'Challenge accepted' : 'Challenge declined',
          message: `${actor.displayName ?? 'Your opponent'} ${accept ? 'accepted' : 'declined'} your challenge.`,
          relatedMatchId: m.id,
        },
      ],
      tx,
    );
    return { match, publish };
  });
  publish();
  if (accept) emitToUser(inv.inviterId, 'match:ready', { matchId: match.id });
  return match;
}

async function expireInvitation(tx: Tx, invitationId: string, m: Match) {
  await tx.matchInvitation.update({ where: { id: invitationId }, data: { status: 'EXPIRED', respondedAt: new Date() } });
  if (m.status === 'WAITING') {
    await tx.match.update({
      where: { id: m.id },
      data: { status: 'CANCELLED', cancelReason: 'Invitation expired', terminationReason: 'CANCELLED' },
    });
  }
}

/** Background job: expire unanswered invitations and stale open challenges. */
export async function expireStaleInvitations() {
  const now = new Date();
  const stale = await prisma.matchInvitation.findMany({
    where: { status: 'PENDING', expiresAt: { lt: now } },
    select: { id: true, matchId: true },
    take: 200,
  });
  for (const inv of stale) {
    await prisma.$transaction(async (tx) => {
      await advisoryLock(tx, `match:${inv.matchId}`);
      const fresh = await tx.matchInvitation.findUnique({ where: { id: inv.id } });
      if (fresh?.status !== 'PENDING') return;
      const m = await tx.match.findUniqueOrThrow({ where: { id: inv.matchId } });
      await expireInvitation(tx, inv.id, m);
    });
  }
  const openCutoff = new Date(now.getTime() - env.INVITATION_TTL_MINUTES * 60_000);
  const openExpired = await prisma.match.updateMany({
    where: { status: 'CREATED', createdAt: { lt: openCutoff } },
    data: { status: 'CANCELLED', cancelReason: 'Open challenge expired', terminationReason: 'CANCELLED' },
  });
  return { invitations: stale.length, openChallenges: openExpired.count };
}

// ---------------------------------------------------------------------------------------------
// Coordinator / admin assigned matches
// ---------------------------------------------------------------------------------------------
export async function createAssignedMatch(
  actor: Actor,
  input: TimeControl & {
    whitePlayerId: string;
    blackPlayerId: string;
    tournamentId?: string;
    scheduledAt?: Date;
    rated: boolean;
    notes?: string;
  },
) {
  if (actor.role !== 'ADMIN' && actor.role !== 'COORDINATOR') throw forbidden();
  if (actor.role === 'COORDINATOR' && !input.tournamentId) {
    throw forbidden('Coordinators schedule matches within an assigned tournament');
  }
  await assertTimeControl(input);
  if (input.tournamentId) await assertCanManageTournament(actor, input.tournamentId);

  const match = await prisma.$transaction(async (tx) => {
    await assertActivePlayer(input.whitePlayerId, tx, 'White player');
    await assertActivePlayer(input.blackPlayerId, tx, 'Black player');
    let source: MatchSource = 'COORDINATOR';
    if (input.tournamentId) {
      const t = await tx.tournament.findUnique({ where: { id: input.tournamentId } });
      if (!t) throw notFound('Tournament');
      if (!['REGISTRATION_CLOSED', 'IN_PROGRESS'].includes(t.status)) {
        throw invalidState('Matches can only be scheduled once registration has closed');
      }
      const registered = await tx.tournamentParticipant.count({
        where: {
          tournamentId: t.id,
          playerId: { in: [input.whitePlayerId, input.blackPlayerId] },
          registrationStatus: 'REGISTERED',
        },
      });
      if (registered !== 2) throw badRequest('Both players must be registered participants of the tournament');
      source = 'TOURNAMENT';
    }
    const m = await tx.match.create({
      data: {
        whitePlayerId: input.whitePlayerId,
        blackPlayerId: input.blackPlayerId,
        ...clockFields(input),
        createdById: actor.id,
        coordinatorId: actor.role === 'COORDINATOR' ? actor.id : null,
        tournamentId: input.tournamentId ?? null,
        source,
        status: 'READY',
        rated: input.rated,
        isPrivate: false,
        scheduledAt: input.scheduledAt ?? null,
        notes: input.notes ?? null,
      },
    });
    await audit(
      {
        actorId: actor.id,
        action: 'match.create_assigned',
        resourceType: 'match',
        resourceId: m.id,
        details: { white: input.whitePlayerId, black: input.blackPlayerId, tournamentId: input.tournamentId ?? null },
      },
      tx,
    );
    const { publish } = await notify(
      [input.whitePlayerId, input.blackPlayerId].map((p) => ({
        recipientId: p,
        type: 'MATCH_ASSIGNED' as const,
        title: 'Match scheduled',
        message: `You have been assigned a match${input.scheduledAt ? ` at ${input.scheduledAt.toISOString()}` : ''}. Open it to play.`,
        relatedMatchId: m.id,
        relatedTournamentId: input.tournamentId ?? null,
      })),
      tx,
    );
    return { m, publish };
  });
  match.publish();
  return match.m;
}

// ---------------------------------------------------------------------------------------------
// Cancellation, notes
// ---------------------------------------------------------------------------------------------
export async function cancelMatch(actor: Actor, matchId: string, reason: string) {
  const { publish, match } = await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `match:${matchId}`);
    const m = await tx.match.findUnique({ where: { id: matchId } });
    if (!m) throw notFound('Match');
    if (!(await canCancelMatch(actor, m))) throw forbidden('You cannot cancel this match');
    if (!PRE_START_STATUSES.includes(m.status)) throw invalidState('Only matches that have not started can be cancelled');
    assertTransition(m.status, 'CANCELLED');
    const match = await tx.match.update({
      where: { id: matchId },
      data: { status: 'CANCELLED', cancelReason: reason, terminationReason: 'CANCELLED', completedAt: new Date() },
    });
    await tx.matchInvitation.updateMany({
      where: { matchId, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    await audit(
      { actorId: actor.id, action: 'match.cancel', resourceType: 'match', resourceId: matchId, details: { reason } },
      tx,
    );
    const recipients = [m.whitePlayerId, m.blackPlayerId].filter((x): x is string => Boolean(x) && x !== actor.id);
    const { publish } = await notify(
      recipients.map((r) => ({
        recipientId: r,
        type: 'MATCH_CANCELLED' as const,
        title: 'Match cancelled',
        message: `A match you were part of was cancelled: ${reason}`,
        relatedMatchId: matchId,
      })),
      tx,
    );
    return { publish, match };
  });
  publish();
  void broadcastState(matchId);
  return match;
}

export async function updateNotes(actor: Actor, matchId: string, notes: string) {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m) throw notFound('Match');
  if (!(await canSuperviseMatch(actor, m))) throw forbidden();
  await prisma.$transaction([
    prisma.match.update({ where: { id: matchId }, data: { notes } }),
    prisma.auditLog.create({
      data: { actorId: actor.id, action: 'match.notes', resourceType: 'match', resourceId: matchId, details: { notes } },
    }),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------
export async function getMatchState(actor: Actor, matchId: string) {
  const m = await loadMatch(matchId);
  if (!m) throw notFound('Match');
  await assertCanViewMatch(actor, m);
  const state = await stateWithClaims(m);
  const supervisor = await canSuperviseMatch(actor, m);
  return { ...state, notes: supervisor ? m.notes : undefined };
}

export async function getReplay(actor: Actor, matchId: string) {
  const m = await loadMatch(matchId);
  if (!m) throw notFound('Match');
  await assertCanViewMatch(actor, m);
  // Validate stored moves by replaying them (also yields per-ply FENs for the viewer).
  const engine = GameEngine.fromMoves(
    m.initialFen,
    m.moves.map((mv) => ({ from: mv.fromSquare, to: mv.toSquare, promotion: (mv.promotion as 'q') ?? null })),
  );
  return {
    matchId: m.id,
    initialFen: m.initialFen,
    finalFen: engine.fen,
    result: m.result,
    terminationReason: m.terminationReason,
    pgn: m.pgn,
    moves: m.moves.map((mv) => ({ ply: mv.ply, san: mv.san, from: mv.fromSquare, to: mv.toSquare, fen: mv.fenAfter, clockAfterMs: mv.clockAfterMs })),
  };
}

export interface ListMatchesQuery {
  status?: Match['status'];
  scope: 'mine' | 'open' | 'public';
  playerId?: string;
  tournamentId?: string;
  coordinatorId?: string;
  from?: Date;
  to?: Date;
  sort: 'createdAt' | 'completedAt' | 'scheduledAt';
  order: 'asc' | 'desc';
}

export async function listMatches(actor: Actor, q: ListMatchesQuery, page: Pagination) {
  const and: Prisma.MatchWhereInput[] = [];
  if (q.scope === 'open') {
    and.push({ status: 'CREATED', isPrivate: false, createdById: { not: actor.id } });
  } else if (q.scope === 'public') {
    and.push({ status: { in: ['COMPLETED', 'ABANDONED'] }, isPrivate: false });
    if (q.playerId) and.push({ OR: [{ whitePlayerId: q.playerId }, { blackPlayerId: q.playerId }] });
  } else if (actor.role === 'PLAYER') {
    and.push({ OR: [{ whitePlayerId: actor.id }, { blackPlayerId: actor.id }, { createdById: actor.id }] });
  } else if (actor.role === 'COORDINATOR') {
    and.push({
      OR: [{ coordinatorId: actor.id }, { tournament: { coordinators: { some: { coordinatorId: actor.id } } } }],
    });
  }
  // Admin "mine" = everything (admin list uses the same function).
  if (q.status) and.push({ status: q.status });
  if (q.tournamentId) and.push({ tournamentId: q.tournamentId });
  if (q.coordinatorId && actor.role === 'ADMIN') and.push({ coordinatorId: q.coordinatorId });
  if (q.playerId && q.scope !== 'public' && actor.role !== 'PLAYER') {
    and.push({ OR: [{ whitePlayerId: q.playerId }, { blackPlayerId: q.playerId }] });
  }
  if (q.from) and.push({ createdAt: { gte: q.from } });
  if (q.to) and.push({ createdAt: { lte: q.to } });

  const where: Prisma.MatchWhereInput = { AND: and };
  const [total, rows] = await prisma.$transaction([
    prisma.match.count({ where }),
    prisma.match.findMany({
      where,
      select: matchListSelect,
      // `nulls` ordering is only valid on nullable columns.
      orderBy: [q.sort === 'createdAt' ? { createdAt: q.order } : { [q.sort]: { sort: q.order, nulls: 'last' } }, { id: 'asc' }],
      ...toSkipTake(page),
    }),
  ]);
  return { items: rows.map(toMatchListItem), meta: pageMeta(page, total) };
}

export async function listInvitations(actor: Actor) {
  return prisma.matchInvitation.findMany({
    where: { OR: [{ inviteeId: actor.id }, { inviterId: actor.id }], status: 'PENDING', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      inviterId: true,
      inviteeId: true,
      inviter: { select: { id: true, username: true, displayName: true, profile: { select: { rating: true } } } },
      invitee: { select: { id: true, username: true, displayName: true, profile: { select: { rating: true } } } },
      match: { select: { id: true, initialTimeMs: true, incrementMs: true, rated: true, whitePlayerId: true, blackPlayerId: true } },
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Matchmaking queue
// ---------------------------------------------------------------------------------------------
export async function enqueue(actor: Actor, input: TimeControl & { rated: boolean }) {
  if (actor.role !== 'PLAYER') throw forbidden('Only players can use matchmaking');
  const settings = await getSettings();
  if (!settings.matchmakingEnabled) throw forbidden('Matchmaking is currently disabled');
  await assertTimeControl(input);

  const outcome = await prisma.$transaction(async (tx) => {
    // Global lock: queue claims are serialized so two players are never matched twice.
    await advisoryLock(tx, 'matchmaking');
    const existing = await tx.matchmakingQueueEntry.findUnique({ where: { userId: actor.id } });
    if (existing) throw conflict('You are already in the matchmaking queue');
    const live = await tx.match.count({
      where: { status: 'IN_PROGRESS', OR: [{ whitePlayerId: actor.id }, { blackPlayerId: actor.id }] },
    });
    if (live > 0) throw conflict('Finish your current game before queueing');

    const profile = await tx.playerProfile.findUniqueOrThrow({ where: { userId: actor.id } });
    const candidates = await tx.matchmakingQueueEntry.findMany({
      where: {
        userId: { not: actor.id },
        initialTimeMs: input.initialTimeMs,
        incrementMs: input.incrementMs,
        rated: input.rated,
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    // Rating window widens by 50 points per 10 seconds of waiting (from ±200).
    const now = Date.now();
    const opponent = candidates.find((c) => {
      const waited = (now - c.createdAt.getTime()) / 10_000;
      return Math.abs(c.rating - profile.rating) <= 200 + 50 * Math.floor(waited);
    });
    if (!opponent) {
      const entry = await tx.matchmakingQueueEntry.create({
        data: { userId: actor.id, initialTimeMs: input.initialTimeMs, incrementMs: input.incrementMs, rated: input.rated, rating: profile.rating },
      });
      return { queued: true as const, entry };
    }
    await tx.matchmakingQueueEntry.delete({ where: { id: opponent.id } });
    const seats = resolveColors(actor.id, opponent.userId, 'random');
    const match = await tx.match.create({
      data: {
        ...seats,
        ...clockFields(input),
        createdById: actor.id,
        source: 'MATCHMAKING',
        status: 'READY',
        rated: input.rated,
      },
    });
    return { queued: false as const, match, opponentId: opponent.userId };
  });

  if (!outcome.queued) {
    for (const uid of [actor.id, outcome.opponentId]) emitToUser(uid, 'matchmaking:matched', { matchId: outcome.match.id });
  }
  return outcome;
}

export async function dequeue(actor: Actor) {
  const res = await prisma.matchmakingQueueEntry.deleteMany({ where: { userId: actor.id } });
  return { removed: res.count > 0 };
}

export async function queueStatus(actor: Actor) {
  const entry = await prisma.matchmakingQueueEntry.findUnique({ where: { userId: actor.id } });
  const waiting = await prisma.matchmakingQueueEntry.count();
  return { entry, playersWaiting: waiting };
}
