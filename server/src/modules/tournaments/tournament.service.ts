/**
 * Tournament lifecycle, registration, pairings and standings.
 *
 * Status transitions (enforced by assertTournamentTransition):
 *   DRAFT → PUBLISHED | CANCELLED
 *   PUBLISHED → DRAFT (unpublish) | REGISTRATION_OPEN | CANCELLED
 *   REGISTRATION_OPEN → REGISTRATION_CLOSED | CANCELLED
 *   REGISTRATION_CLOSED → REGISTRATION_OPEN | IN_PROGRESS | CANCELLED
 *   IN_PROGRESS → COMPLETED (automatic, when the last round finishes) | CANCELLED
 */
import type { Prisma, Tournament, TournamentFormat, TournamentStatus } from '@prisma/client';
import { z } from 'zod';
import { logger } from '../../config/logger.js';
import { badRequest, conflict, forbidden, invalidState, notFound } from '../../lib/errors.js';
import { pageMeta, toSkipTake, type Pagination } from '../../lib/pagination.js';
import { advisoryLock, prisma, type Tx } from '../../lib/prisma.js';
import { assertCanManageTournament, canManageTournament, type Actor } from '../../policies/index.js';
import { audit } from '../audit/audit.service.js';
import { STANDARD_FEN } from '../chess/engine.js';
import { isAllowedTimeControl } from '../chess/timeControls.js';
import { onMatchFinalized, type FinalizedMatchInfo } from '../matches/hooks.js';
import { matchListSelect, toMatchListItem } from '../matches/match.view.js';
import { notify } from '../notifications/notification.service.js';
import { getSettings } from '../settings/settings.service.js';
import { knockoutFirstRound, knockoutNextRound, knockoutRoundCount, roundRobinSchedule, type Pairing } from './pairing.js';
import { computeStandings } from './standings.js';

const TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['DRAFT', 'REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Transitions only admins may perform; coordinators handle the operational ones. */
const ADMIN_ONLY: TournamentStatus[] = ['PUBLISHED', 'DRAFT', 'CANCELLED'];

export function assertTournamentTransition(from: TournamentStatus, to: TournamentStatus) {
  if (!TRANSITIONS[from].includes(to)) throw invalidState(`Tournament cannot move from ${from} to ${to}`);
}

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------
const baseFields = {
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(4000).default(''),
  format: z.enum(['ROUND_ROBIN', 'SINGLE_ELIMINATION']),
  initialTimeMs: z.number().int().min(30_000).max(3 * 60 * 60_000),
  incrementMs: z.number().int().min(0).max(180_000),
  rated: z.boolean().default(true),
  maxParticipants: z.number().int().min(2).max(512),
  minParticipants: z.number().int().min(2).max(512).default(2),
  pointsWin: z.number().min(0).max(10).default(1),
  pointsDraw: z.number().min(0).max(10).default(0.5),
  pointsLoss: z.number().min(0).max(10).default(0),
  pointsBye: z.number().min(0).max(10).default(1),
  registrationOpensAt: z.coerce.date().nullable().optional(),
  registrationClosesAt: z.coerce.date().nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
};

export const createTournamentSchema = z
  .object({ ...baseFields, coordinatorIds: z.array(z.string().min(1).max(40)).max(10).default([]) })
  .strict();

export const updateTournamentSchema = z
  .object(Object.fromEntries(Object.entries(baseFields).map(([k, v]) => [k, (v as z.ZodType).optional()])) as {
    [K in keyof typeof baseFields]: z.ZodOptional<(typeof baseFields)[K]>;
  })
  .strict();

export const transitionSchema = z
  .object({
    status: z.enum(['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'CANCELLED']),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

export const listTournamentsQuery = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  format: z.enum(['ROUND_ROBIN', 'SINGLE_ELIMINATION']).optional(),
  search: z.string().trim().max(120).optional(),
  scope: z.enum(['all', 'assigned', 'registered']).default('all'),
});

function validateDates(d: {
  registrationOpensAt?: Date | null;
  registrationClosesAt?: Date | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
}) {
  if (d.registrationOpensAt && d.registrationClosesAt && d.registrationOpensAt >= d.registrationClosesAt) {
    throw badRequest('Registration must open before it closes');
  }
  if (d.startsAt && d.endsAt && d.startsAt >= d.endsAt) throw badRequest('The tournament must start before it ends');
  if (d.registrationClosesAt && d.startsAt && d.registrationClosesAt > d.startsAt) {
    throw badRequest('Registration must close before the tournament starts');
  }
}

async function assertCoordinators(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.user.count({ where: { id: { in: ids }, role: 'COORDINATOR', accountStatus: 'ACTIVE' } });
  if (found !== new Set(ids).size) throw badRequest('Every assigned coordinator must be an active coordinator account');
}

// ---------------------------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------------------------
export async function createTournament(actor: Actor, input: z.infer<typeof createTournamentSchema>) {
  if (actor.role !== 'ADMIN') throw forbidden();
  const settings = await getSettings();
  if (!isAllowedTimeControl(input, settings)) throw badRequest('This time control is not allowed');
  if (input.maxParticipants > settings.maxTournamentParticipants) {
    throw badRequest(`At most ${settings.maxTournamentParticipants} participants are allowed`);
  }
  if (input.minParticipants > input.maxParticipants) throw badRequest('Minimum participants exceeds the maximum');
  validateDates(input);
  const { coordinatorIds, ...data } = input;
  return prisma.$transaction(async (tx) => {
    await assertCoordinators(tx, coordinatorIds);
    const t = await tx.tournament.create({
      data: { ...data, createdById: actor.id, coordinators: { create: [...new Set(coordinatorIds)].map((id) => ({ coordinatorId: id })) } },
    });
    await audit({ actorId: actor.id, action: 'tournament.create', resourceType: 'tournament', resourceId: t.id, details: { name: t.name } }, tx);
    return t;
  });
}

export async function updateTournament(actor: Actor, id: string, input: z.infer<typeof updateTournamentSchema>) {
  await assertCanManageTournament(actor, id);
  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `tournament:${id}`);
    const t = await tx.tournament.findUniqueOrThrow({ where: { id } });
    if (['COMPLETED', 'CANCELLED'].includes(t.status)) throw invalidState('Finished tournaments cannot be edited');
    const structural = ['format', 'initialTimeMs', 'incrementMs', 'rated', 'pointsWin', 'pointsDraw', 'pointsLoss', 'pointsBye'] as const;
    if (t.status === 'IN_PROGRESS' && structural.some((k) => input[k] !== undefined)) {
      throw invalidState('Format, time control and scoring cannot change once the tournament has started');
    }
    const merged = { ...t, ...input };
    validateDates(merged);
    if (input.initialTimeMs !== undefined || input.incrementMs !== undefined) {
      if (!isAllowedTimeControl(merged, await getSettings())) throw badRequest('This time control is not allowed');
    }
    if (merged.minParticipants > merged.maxParticipants) throw badRequest('Minimum participants exceeds the maximum');
    if (input.maxParticipants !== undefined) {
      const registered = await tx.tournamentParticipant.count({ where: { tournamentId: id, registrationStatus: 'REGISTERED' } });
      if (input.maxParticipants < registered) throw badRequest(`${registered} players are already registered`);
    }
    const updated = await tx.tournament.update({ where: { id }, data: input });
    await audit({ actorId: actor.id, action: 'tournament.update', resourceType: 'tournament', resourceId: id, details: { fields: Object.keys(input) } }, tx);
    return updated;
  });
}

export async function setCoordinators(actor: Actor, id: string, coordinatorIds: string[]) {
  if (actor.role !== 'ADMIN') throw forbidden();
  const unique = [...new Set(coordinatorIds)];
  await prisma.$transaction(async (tx) => {
    await tx.tournament.findUniqueOrThrow({ where: { id } });
    await assertCoordinators(tx, unique);
    await tx.coordinatorAssignment.deleteMany({ where: { tournamentId: id, coordinatorId: { notIn: unique } } });
    for (const cid of unique) {
      await tx.coordinatorAssignment.upsert({
        where: { coordinatorId_tournamentId: { coordinatorId: cid, tournamentId: id } },
        create: { coordinatorId: cid, tournamentId: id },
        update: {},
      });
    }
    await audit({ actorId: actor.id, action: 'tournament.coordinators', resourceType: 'tournament', resourceId: id, details: { coordinatorIds: unique } }, tx);
  });
}

/** DRAFT tournaments are visible only to admins and assigned coordinators. */
async function assertCanSee(actor: Actor | null, t: Pick<Tournament, 'id' | 'status'>) {
  if (t.status !== 'DRAFT') return;
  if (actor && (await canManageTournament(actor, t.id))) return;
  throw notFound('Tournament');
}

export async function listTournaments(actor: Actor | null, q: z.infer<typeof listTournamentsQuery>, page: Pagination) {
  const and: Prisma.TournamentWhereInput[] = [];
  if (q.status) and.push({ status: q.status });
  if (q.format) and.push({ format: q.format });
  if (q.search) and.push({ name: { contains: q.search, mode: 'insensitive' } });
  if (q.scope === 'assigned' && actor) and.push({ coordinators: { some: { coordinatorId: actor.id } } });
  if (q.scope === 'registered' && actor) and.push({ participants: { some: { playerId: actor.id, registrationStatus: { in: ['REGISTERED', 'ELIMINATED'] } } } });
  if (actor?.role !== 'ADMIN') {
    and.push(
      actor?.role === 'COORDINATOR'
        ? { OR: [{ status: { not: 'DRAFT' } }, { coordinators: { some: { coordinatorId: actor.id } } }] }
        : { status: { not: 'DRAFT' } },
    );
  }
  const where: Prisma.TournamentWhereInput = { AND: and };
  const [total, items] = await prisma.$transaction([
    prisma.tournament.count({ where }),
    prisma.tournament.findMany({
      where,
      orderBy: [{ startsAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      ...toSkipTake(page),
      include: {
        _count: { select: { participants: { where: { registrationStatus: { in: ['REGISTERED', 'ELIMINATED'] } } } } },
        coordinators: { select: { coordinator: { select: { id: true, displayName: true } } } },
        winner: { select: { id: true, displayName: true } },
      },
    }),
  ]);
  return { items, meta: pageMeta(page, total) };
}

export async function getTournament(actor: Actor | null, id: string) {
  const t = await prisma.tournament.findUnique({
    where: { id },
    include: {
      coordinators: { select: { coordinator: { select: { id: true, username: true, displayName: true } } } },
      winner: { select: { id: true, displayName: true, username: true } },
      createdBy: { select: { id: true, displayName: true } },
      _count: { select: { participants: { where: { registrationStatus: { in: ['REGISTERED', 'ELIMINATED'] } } }, rounds: true } },
    },
  });
  if (!t) throw notFound('Tournament');
  await assertCanSee(actor, t);
  const canManage = actor ? await canManageTournament(actor, id) : false;
  const myRegistration = actor
    ? await prisma.tournamentParticipant.findUnique({ where: { tournamentId_playerId: { tournamentId: id, playerId: actor.id } }, select: { registrationStatus: true } })
    : null;
  return {
    ...t,
    pointsWin: Number(t.pointsWin),
    pointsDraw: Number(t.pointsDraw),
    pointsLoss: Number(t.pointsLoss),
    pointsBye: Number(t.pointsBye),
    canManage,
    myRegistration: myRegistration?.registrationStatus ?? null,
    plannedRounds: plannedRounds(t.format, t._count.participants),
  };
}

const plannedRounds = (format: TournamentFormat, players: number) =>
  players < 2 ? 0 : format === 'ROUND_ROBIN' ? (players % 2 === 0 ? players - 1 : players) : knockoutRoundCount(players);

// ---------------------------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------------------------
export async function transitionTournament(actor: Actor, id: string, to: TournamentStatus, reason?: string) {
  await assertCanManageTournament(actor, id);
  if (ADMIN_ONLY.includes(to) && actor.role !== 'ADMIN') throw forbidden('Only administrators can publish, unpublish or cancel tournaments');
  if (to === 'CANCELLED' && !reason) throw badRequest('A reason is required to cancel a tournament');

  const { t, publish } = await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `tournament:${id}`);
    const current = await tx.tournament.findUniqueOrThrow({ where: { id } });
    assertTournamentTransition(current.status, to);
    let publish = () => {};

    if (to === 'IN_PROGRESS') {
      const participants = await tx.tournamentParticipant.findMany({
        where: { tournamentId: id, registrationStatus: 'REGISTERED' },
        orderBy: [{ ratingAtRegistration: 'desc' }, { registeredAt: 'asc' }],
      });
      if (participants.length < Math.max(2, current.minParticipants)) {
        throw invalidState(`At least ${Math.max(2, current.minParticipants)} registered players are required to start`);
      }
      // Seeds by rating at registration (ties: earlier registration first).
      for (const [i, p] of participants.entries()) {
        await tx.tournamentParticipant.update({ where: { id: p.id }, data: { seed: i + 1 } });
      }
    }
    if (to === 'CANCELLED') {
      await tx.match.updateMany({
        where: { tournamentId: id, status: { in: ['CREATED', 'WAITING', 'READY'] } },
        data: { status: 'CANCELLED', cancelReason: `Tournament cancelled: ${reason}`, terminationReason: 'CANCELLED' },
      });
      const parts = await tx.tournamentParticipant.findMany({ where: { tournamentId: id, registrationStatus: 'REGISTERED' }, select: { playerId: true } });
      ({ publish } = await notify(
        parts.map((p) => ({ recipientId: p.playerId, type: 'TOURNAMENT_ANNOUNCEMENT' as const, title: `${current.name} cancelled`, message: reason ?? '', relatedTournamentId: id })),
        tx,
      ));
    }
    const t = await tx.tournament.update({
      where: { id },
      data: { status: to, ...(to === 'CANCELLED' ? { cancelReason: reason } : {}), ...(to === 'IN_PROGRESS' && !current.startsAt ? { startsAt: new Date() } : {}) },
    });
    await audit({ actorId: actor.id, action: 'tournament.transition', resourceType: 'tournament', resourceId: id, details: { from: current.status, to, reason: reason ?? null } }, tx);
    return { t, publish };
  });
  publish();
  logger.info({ tournamentId: id, to }, 'Tournament transition');
  return t;
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------
async function registerPlayer(tx: Tx, t: Tournament, playerId: string, byManager: boolean) {
  const allowed: TournamentStatus[] = byManager ? ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] : ['REGISTRATION_OPEN'];
  if (!allowed.includes(t.status)) throw invalidState('Registration is not open for this tournament');
  const now = new Date();
  if (!byManager) {
    if (t.registrationOpensAt && now < t.registrationOpensAt) throw invalidState('Registration has not opened yet');
    if (t.registrationClosesAt && now > t.registrationClosesAt) throw invalidState('The registration deadline has passed');
  }
  const player = await tx.user.findUnique({ where: { id: playerId }, select: { role: true, accountStatus: true, profile: { select: { rating: true } } } });
  if (!player || player.role !== 'PLAYER') throw notFound('Player');
  if (player.accountStatus !== 'ACTIVE') throw badRequest('Only active accounts can register');
  const registered = await tx.tournamentParticipant.count({ where: { tournamentId: t.id, registrationStatus: 'REGISTERED' } });
  const existing = await tx.tournamentParticipant.findUnique({ where: { tournamentId_playerId: { tournamentId: t.id, playerId } } });
  if (existing?.registrationStatus === 'REGISTERED') throw conflict('Already registered');
  if (existing?.registrationStatus === 'REMOVED' && !byManager) throw forbidden('You were removed from this tournament by a coordinator');
  if (registered >= t.maxParticipants) throw conflict('This tournament is full');
  const rating = player.profile?.rating ?? 1200;
  return existing
    ? tx.tournamentParticipant.update({ where: { id: existing.id }, data: { registrationStatus: 'REGISTERED', registeredAt: now, ratingAtRegistration: rating } })
    : tx.tournamentParticipant.create({ data: { tournamentId: t.id, playerId, ratingAtRegistration: rating } });
}

export async function register(actor: Actor, tournamentId: string) {
  if (actor.role !== 'PLAYER') throw forbidden('Only players can register');
  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `tournament:${tournamentId}`);
    const t = await tx.tournament.findUnique({ where: { id: tournamentId } });
    if (!t || t.status === 'DRAFT') throw notFound('Tournament');
    const p = await registerPlayer(tx, t, actor.id, false);
    await audit({ actorId: actor.id, action: 'tournament.register', resourceType: 'tournament', resourceId: tournamentId }, tx);
    return p;
  });
}

export async function withdraw(actor: Actor, tournamentId: string) {
  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `tournament:${tournamentId}`);
    const t = await tx.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw notFound('Tournament');
    if (t.status !== 'REGISTRATION_OPEN') throw invalidState('You can only withdraw while registration is open');
    const p = await tx.tournamentParticipant.findUnique({ where: { tournamentId_playerId: { tournamentId, playerId: actor.id } } });
    if (p?.registrationStatus !== 'REGISTERED') throw notFound('Registration');
    await tx.tournamentParticipant.update({ where: { id: p.id }, data: { registrationStatus: 'WITHDRAWN' } });
    await audit({ actorId: actor.id, action: 'tournament.withdraw', resourceType: 'tournament', resourceId: tournamentId }, tx);
  });
}

export async function addParticipant(actor: Actor, tournamentId: string, playerId: string) {
  await assertCanManageTournament(actor, tournamentId);
  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `tournament:${tournamentId}`);
    const t = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const p = await registerPlayer(tx, t, playerId, true);
    await audit({ actorId: actor.id, action: 'tournament.participant_add', resourceType: 'tournament', resourceId: tournamentId, details: { playerId } }, tx);
    const { publish } = await notify(
      [{ recipientId: playerId, type: 'TOURNAMENT_REGISTRATION', title: `Registered for ${t.name}`, message: 'A coordinator registered you for this tournament.', relatedTournamentId: tournamentId }],
      tx,
    );
    return { p, publish };
  }).then(({ p, publish }) => {
    publish();
    return p;
  });
}

export async function removeParticipant(actor: Actor, tournamentId: string, playerId: string, reason: string) {
  await assertCanManageTournament(actor, tournamentId);
  await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `tournament:${tournamentId}`);
    const t = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    if (!['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(t.status)) {
      throw invalidState('Participants can only be removed before the tournament starts');
    }
    const p = await tx.tournamentParticipant.findUnique({ where: { tournamentId_playerId: { tournamentId, playerId } } });
    if (p?.registrationStatus !== 'REGISTERED') throw notFound('Registration');
    await tx.tournamentParticipant.update({ where: { id: p.id }, data: { registrationStatus: 'REMOVED' } });
    await audit({ actorId: actor.id, action: 'tournament.participant_remove', resourceType: 'tournament', resourceId: tournamentId, details: { playerId, reason } }, tx);
  });
}

export async function listParticipants(actor: Actor | null, tournamentId: string) {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true, status: true } });
  if (!t) throw notFound('Tournament');
  await assertCanSee(actor, t);
  return prisma.tournamentParticipant.findMany({
    where: { tournamentId, registrationStatus: { in: ['REGISTERED', 'ELIMINATED'] } },
    orderBy: [{ seed: { sort: 'asc', nulls: 'last' } }, { ratingAtRegistration: 'desc' }, { registeredAt: 'asc' }],
    select: {
      registrationStatus: true,
      registeredAt: true,
      seed: true,
      ratingAtRegistration: true,
      player: { select: { id: true, username: true, displayName: true, profile: { select: { rating: true } } } },
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------------------------
export async function standings(actor: Actor | null, tournamentId: string, tx: Tx = prisma) {
  const t = await tx.tournament.findUnique({ where: { id: tournamentId } });
  if (!t) throw notFound('Tournament');
  if (actor) await assertCanSee(actor, t);
  const parts = await tx.tournamentParticipant.findMany({
    where: { tournamentId, registrationStatus: { in: ['REGISTERED', 'ELIMINATED'] } },
    select: { seed: true, registrationStatus: true, player: { select: { id: true, username: true, displayName: true, profile: { select: { rating: true } } } } },
  });
  const games = await tx.match.findMany({
    where: { tournamentId, status: { in: ['COMPLETED', 'ABANDONED', 'DISPUTED'] }, result: { not: null } },
    select: { whitePlayerId: true, blackPlayerId: true, result: true, isBye: true },
  });
  const rows = computeStandings(
    parts.map((p) => ({ id: p.player.id, username: p.player.username, displayName: p.player.displayName, seed: p.seed, rating: p.player.profile?.rating ?? null })),
    games.map((g) => ({ whiteId: g.whitePlayerId, blackId: g.blackPlayerId, result: g.result!, isBye: g.isBye })),
    { win: Number(t.pointsWin), draw: Number(t.pointsDraw), loss: Number(t.pointsLoss), bye: Number(t.pointsBye) },
  );
  const eliminated = new Set(parts.filter((p) => p.registrationStatus === 'ELIMINATED').map((p) => p.player.id));
  return rows.map((r) => ({ ...r, eliminated: eliminated.has(r.id) }));
}

// ---------------------------------------------------------------------------------------------
// Rounds and pairings
// ---------------------------------------------------------------------------------------------
export async function listRounds(actor: Actor | null, tournamentId: string) {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true, status: true } });
  if (!t) throw notFound('Tournament');
  await assertCanSee(actor, t);
  const rounds = await prisma.tournamentRound.findMany({
    where: { tournamentId },
    orderBy: { roundNumber: 'asc' },
    include: { matches: { select: { ...matchListSelect, bracketSlot: true, isBye: true }, orderBy: [{ bracketSlot: 'asc' }, { createdAt: 'asc' }] } },
  });
  return rounds.map((r) => ({ ...r, matches: r.matches.map((m) => ({ ...toMatchListItem(m), bracketSlot: m.bracketSlot, isBye: m.isBye })) }));
}

async function createRoundMatches(
  tx: Tx,
  t: Tournament,
  roundId: string,
  pairings: Pairing<string>[],
  coordinatorId: string | null,
  createdById: string,
) {
  const created: { id: string; white: string; black: string | null }[] = [];
  for (const p of pairings) {
    if (!p.white) continue;
    const isBye = p.black === null;
    const m = await tx.match.create({
      data: {
        whitePlayerId: p.white,
        blackPlayerId: p.black,
        createdById,
        coordinatorId,
        tournamentId: t.id,
        roundId,
        source: 'TOURNAMENT',
        status: isBye ? 'COMPLETED' : 'READY',
        result: isBye ? 'WHITE_WIN' : null,
        winnerId: isBye ? p.white : null,
        terminationReason: isBye ? 'BYE' : null,
        completedAt: isBye ? new Date() : null,
        isBye,
        rated: isBye ? false : t.rated,
        bracketSlot: p.slot,
        initialTimeMs: t.initialTimeMs,
        incrementMs: t.incrementMs,
        whiteTimeRemainingMs: t.initialTimeMs,
        blackTimeRemainingMs: t.initialTimeMs,
        initialFen: STANDARD_FEN,
        currentFen: STANDARD_FEN,
      },
    });
    created.push({ id: m.id, white: p.white, black: p.black });
  }
  return created;
}

/** Winner of each bracket slot in a knockout round (latest decisive match per slot), or null. */
async function knockoutWinners(tx: Tx, roundId: string): Promise<{ slots: (string | null)[]; complete: boolean }> {
  const matches = await tx.match.findMany({ where: { roundId }, orderBy: { createdAt: 'asc' } });
  const bySlot = new Map<number, typeof matches>();
  for (const m of matches) {
    const list = bySlot.get(m.bracketSlot ?? 0) ?? [];
    list.push(m);
    bySlot.set(m.bracketSlot ?? 0, list);
  }
  const slots: (string | null)[] = [];
  let complete = true;
  const count = Math.max(...[...bySlot.keys()].map((k) => k + 1), 0);
  for (let s = 0; s < count; s++) {
    const list = bySlot.get(s) ?? [];
    const decisive = list.find((m) => ['COMPLETED', 'ABANDONED'].includes(m.status) && m.winnerId);
    if (decisive) slots.push(decisive.winnerId);
    else {
      slots.push(null);
      complete = false;
    }
  }
  return { slots, complete };
}

/** Generates and publishes the next round's pairings. Previous round must be complete. */
export async function generateNextRound(actor: Actor, tournamentId: string) {
  await assertCanManageTournament(actor, tournamentId);
  const { round, publish } = await prisma.$transaction(
    async (tx) => {
      await advisoryLock(tx, `tournament:${tournamentId}`);
      const t = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
      if (t.status !== 'IN_PROGRESS') throw invalidState('Start the tournament before generating pairings');
      const last = await tx.tournamentRound.findFirst({ where: { tournamentId }, orderBy: { roundNumber: 'desc' } });
      if (last && last.status !== 'COMPLETED') throw invalidState(`Round ${last.roundNumber} is not complete yet`);

      const participants = await tx.tournamentParticipant.findMany({
        where: { tournamentId, registrationStatus: { in: ['REGISTERED', 'ELIMINATED'] } },
        orderBy: { seed: 'asc' },
      });
      const nextNumber = (last?.roundNumber ?? 0) + 1;
      let pairings: Pairing<string>[];

      if (t.format === 'ROUND_ROBIN') {
        const schedule = roundRobinSchedule(participants.map((p) => p.playerId));
        if (nextNumber > schedule.length) throw invalidState('All round-robin rounds have been played');
        pairings = schedule[nextNumber - 1]!;
      } else if (!last) {
        pairings = knockoutFirstRound(participants.map((p) => p.playerId));
      } else {
        const { slots } = await knockoutWinners(tx, last.id);
        if (slots.length <= 1) throw invalidState('The knockout is already decided');
        pairings = knockoutNextRound(slots);
      }

      const round = await tx.tournamentRound.create({
        data: { tournamentId, roundNumber: nextNumber, status: 'IN_PROGRESS', startsAt: new Date() },
      });
      const created = await createRoundMatches(tx, t, round.id, pairings, actor.role === 'COORDINATOR' ? actor.id : null, actor.id);
      await audit({ actorId: actor.id, action: 'tournament.pairings', resourceType: 'tournament', resourceId: tournamentId, details: { round: nextNumber, matches: created.length } }, tx);
      const { publish } = await notify(
        created.flatMap((m) =>
          [m.white, m.black].filter((x): x is string => Boolean(x)).map((pid) => ({
            recipientId: pid,
            type: 'TOURNAMENT_PAIRINGS' as const,
            title: `${t.name}: round ${nextNumber}`,
            message: m.black ? 'Your pairing is ready. Open the game to play.' : 'You have a bye this round.',
            relatedMatchId: m.id,
            relatedTournamentId: tournamentId,
          })),
        ),
        tx,
      );
      // A round consisting only of byes is complete immediately.
      const publishRound = await refreshRoundState(tx, t.id, round.id);
      return {
        round,
        publish: () => {
          publish();
          publishRound?.();
        },
      };
    },
    { timeout: 30_000 },
  );
  publish();
  return round;
}

/**
 * Marks the round complete when every game has a final result, applies knockout eliminations,
 * schedules a knockout re-match for drawn games, and completes the tournament after the last round.
 */
async function refreshRoundState(tx: Tx, tournamentId: string, roundId: string) {
  const t = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const round = await tx.tournamentRound.findUniqueOrThrow({ where: { id: roundId } });
  const matches = await tx.match.findMany({ where: { roundId } });
  const pending = matches.filter((m) => !['COMPLETED', 'ABANDONED', 'CANCELLED'].includes(m.status));
  const notifications: Parameters<typeof notify>[0] = [];

  if (t.format === 'SINGLE_ELIMINATION') {
    // Drawn / no-result knockout games are replayed with colours reversed.
    const bySlot = new Map<number, typeof matches>();
    for (const m of matches) bySlot.set(m.bracketSlot ?? 0, [...(bySlot.get(m.bracketSlot ?? 0) ?? []), m]);
    for (const [slot, list] of bySlot) {
      const decided = list.some((m) => m.winnerId && ['COMPLETED', 'ABANDONED'].includes(m.status));
      const live = list.some((m) => !['COMPLETED', 'ABANDONED', 'CANCELLED'].includes(m.status));
      const latest = list[list.length - 1]!;
      if (!decided && !live && latest.whitePlayerId && latest.blackPlayerId && ['COMPLETED', 'ABANDONED'].includes(latest.status)) {
        const [rm] = await createRoundMatches(tx, t, roundId, [{ white: latest.blackPlayerId, black: latest.whitePlayerId, slot }], latest.coordinatorId, latest.createdById);
        for (const pid of [latest.whitePlayerId, latest.blackPlayerId]) {
          notifications.push({ recipientId: pid, type: 'TOURNAMENT_PAIRINGS', title: `${t.name}: re-match`, message: 'Your knockout game was drawn; a deciding re-match has been scheduled.', relatedMatchId: rm!.id, relatedTournamentId: t.id });
        }
        pending.push({ ...latest, status: 'READY' });
      }
      if (decided) {
        const winner = list.find((m) => m.winnerId && ['COMPLETED', 'ABANDONED'].includes(m.status))!;
        const loser = winner.winnerId === winner.whitePlayerId ? winner.blackPlayerId : winner.whitePlayerId;
        if (loser) {
          await tx.tournamentParticipant.updateMany({ where: { tournamentId, playerId: loser, registrationStatus: 'REGISTERED' }, data: { registrationStatus: 'ELIMINATED' } });
        }
      }
    }
  }

  if (pending.length === 0 && round.status !== 'COMPLETED') {
    await tx.tournamentRound.update({ where: { id: roundId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const players = await tx.tournamentParticipant.count({ where: { tournamentId, registrationStatus: { in: ['REGISTERED', 'ELIMINATED'] } } });
    const finalRound = round.roundNumber >= plannedRounds(t.format, players);
    if (finalRound) {
      let winnerId: string | null = null;
      if (t.format === 'SINGLE_ELIMINATION') {
        winnerId = (await knockoutWinners(tx, roundId)).slots[0] ?? null;
      } else {
        winnerId = (await standings(null, tournamentId, tx))[0]?.id ?? null;
      }
      await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'COMPLETED', winnerId, endsAt: t.endsAt ?? new Date() } });
      await audit({ actorId: null, action: 'tournament.completed', resourceType: 'tournament', resourceId: tournamentId, details: { winnerId } }, tx);
      const parts = await tx.tournamentParticipant.findMany({ where: { tournamentId }, select: { playerId: true } });
      for (const p of parts) {
        notifications.push({ recipientId: p.playerId, type: 'TOURNAMENT_ANNOUNCEMENT', title: `${t.name} has finished`, message: 'Final standings are available.', relatedTournamentId: tournamentId });
      }
    }
  }
  if (notifications.length) return (await notify(notifications, tx)).publish;
  return undefined;
}

/**
 * Re-derives the winner of a completed tournament after an administrative result correction.
 * Returns the new winner id (audited when it changes).
 */
export async function recomputeWinner(tx: Tx, tournamentId: string, actorId: string): Promise<string | null> {
  const t = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  if (t.status !== 'COMPLETED') return t.winnerId;
  let winnerId: string | null;
  if (t.format === 'SINGLE_ELIMINATION') {
    const last = await tx.tournamentRound.findFirst({ where: { tournamentId }, orderBy: { roundNumber: 'desc' } });
    winnerId = last ? ((await knockoutWinners(tx, last.id)).slots[0] ?? null) : null;
  } else {
    winnerId = (await standings(null, tournamentId, tx))[0]?.id ?? null;
  }
  if (winnerId !== t.winnerId) {
    await tx.tournament.update({ where: { id: tournamentId }, data: { winnerId } });
    await audit({ actorId, action: 'tournament.winner_recomputed', resourceType: 'tournament', resourceId: tournamentId, details: { from: t.winnerId, to: winnerId } }, tx);
  }
  return winnerId;
}

// Run inside every match finalization (same transaction).
onMatchFinalized(async (tx: Tx, m: FinalizedMatchInfo) => {
  if (!m.tournamentId || !m.roundId) return;
  return refreshRoundState(tx, m.tournamentId, m.roundId);
});

// ---------------------------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------------------------
export const announcementSchema = z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(1).max(4000) }).strict();

export async function createAnnouncement(actor: Actor, tournamentId: string, input: z.infer<typeof announcementSchema>) {
  await assertCanManageTournament(actor, tournamentId);
  const { a, publish } = await prisma.$transaction(async (tx) => {
    const t = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const a = await tx.announcement.create({ data: { tournamentId, authorId: actor.id, ...input } });
    const parts = await tx.tournamentParticipant.findMany({ where: { tournamentId, registrationStatus: { in: ['REGISTERED', 'ELIMINATED'] } }, select: { playerId: true } });
    const { publish } = await notify(
      parts.map((p) => ({ recipientId: p.playerId, type: 'TOURNAMENT_ANNOUNCEMENT' as const, title: `${t.name}: ${input.title}`, message: input.body.slice(0, 1000), relatedTournamentId: tournamentId })),
      tx,
    );
    await audit({ actorId: actor.id, action: 'tournament.announcement', resourceType: 'tournament', resourceId: tournamentId }, tx);
    return { a, publish };
  });
  publish();
  return a;
}

export async function listAnnouncements(actor: Actor | null, tournamentId: string) {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true, status: true } });
  if (!t) throw notFound('Tournament');
  await assertCanSee(actor, t);
  return prisma.announcement.findMany({
    where: { tournamentId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { author: { select: { id: true, displayName: true } } },
  });
}
