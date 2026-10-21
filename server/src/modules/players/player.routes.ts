import { Router } from 'express';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors.js';
import { pageMeta, paginationSchema, toSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { validate } from '../../lib/validate.js';
import { getAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import { changePasswordSchema, displayNameSchema } from '../auth/auth.schemas.js';
import { changePassword } from '../auth/auth.service.js';
import { matchListSelect, toMatchListItem } from '../matches/match.view.js';
import { listInvitations } from '../matches/match.service.js';
import { privateUserSelect, publicUserSelect } from '../users/user.mapper.js';
import { announceLeaderboardChange } from '../realtime/emitter.js';
import { leaderboard, rankOf, statsForOne } from './stats.service.js';

export const AVATARS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const;

export const playerRouter = Router();
export const leaderboardRouter = Router();

const idParam = (raw: unknown) => validate(z.object({ id: z.string().min(1).max(40) }), raw).id;

/** Public leaderboard (no authentication required). */
leaderboardRouter.get('/', async (req, res) => {
  const page = validate(paginationSchema, req.query);
  const { items, total } = await leaderboard(page.page, page.pageSize);
  res.json({ data: items, meta: pageMeta(page, total) });
});

/** Search active players (used for invitations / participant management). */
playerRouter.get('/', requireAuth, async (req, res) => {
  const page = validate(paginationSchema, req.query);
  const { search } = validate(z.object({ search: z.string().trim().max(64).optional() }), req.query);
  const where = {
    role: 'PLAYER' as const,
    accountStatus: 'ACTIVE' as const,
    ...(search
      ? {
          OR: [
            { username: { contains: search.toLowerCase() } },
            { displayName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [total, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select: publicUserSelect, orderBy: [{ username: 'asc' }], ...toSkipTake(page) }),
  ]);
  res.json({ data: items, meta: pageMeta(page, total) });
});

const updateMeSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    avatar: z.enum(AVATARS).nullable().optional(),
    profilePublic: z.boolean().optional(),
    notifyByEmail: z.boolean().optional(),
  })
  .strict();

playerRouter.patch('/me', requireAuth, async (req, res) => {
  const input = validate(updateMeSchema, req.body);
  const user = await prisma.user.update({ where: { id: getAuth(req).user.id }, data: input, select: privateUserSelect });
  if (input.displayName !== undefined || input.profilePublic !== undefined) announceLeaderboardChange();
  res.json({ data: { user } });
});

playerRouter.patch('/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = validate(changePasswordSchema, req.body);
  const { user, sessionId } = getAuth(req);
  await changePassword(user.id, sessionId, currentPassword, newPassword);
  res.json({ data: { ok: true } });
});

playerRouter.get('/me/activity', requireAuth, async (req, res) => {
  const page = validate(paginationSchema, req.query);
  const where = { actorId: getAuth(req).user.id };
  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, action: true, resourceType: true, resourceId: true, createdAt: true },
      ...toSkipTake(page),
    }),
  ]);
  res.json({ data: items, meta: pageMeta(page, total) });
});

/** Everything the player dashboard needs, computed from persisted data. */
playerRouter.get('/me/dashboard', requireRole('PLAYER'), async (req, res) => {
  const { user } = getAuth(req);
  const mine = { OR: [{ whitePlayerId: user.id }, { blackPlayerId: user.id }] };
  const [profile, stats, rank, active, upcoming, recent, invitations, tournaments, ratingHistory] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: privateUserSelect }),
    statsForOne(user.id),
    rankOf(user.id),
    prisma.match.findMany({ where: { ...mine, status: 'IN_PROGRESS' }, select: matchListSelect }),
    prisma.match.findMany({
      where: { ...mine, status: { in: ['READY', 'WAITING', 'CREATED'] } },
      select: matchListSelect,
      orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 20,
    }),
    prisma.match.findMany({
      where: { ...mine, status: { in: ['COMPLETED', 'ABANDONED', 'DISPUTED'] }, isBye: false },
      select: matchListSelect,
      orderBy: { completedAt: 'desc' },
      take: 10,
    }),
    listInvitations(user),
    prisma.tournamentParticipant.findMany({
      where: { playerId: user.id, registrationStatus: { in: ['REGISTERED', 'ELIMINATED'] } },
      select: {
        registrationStatus: true,
        tournament: { select: { id: true, name: true, status: true, format: true, startsAt: true } },
      },
      orderBy: { registeredAt: 'desc' },
      take: 10,
    }),
    prisma.ratingHistory.findMany({
      where: { playerId: user.id, reversed: false },
      orderBy: { createdAt: 'asc' },
      select: { ratingAfter: true, ratingChange: true, createdAt: true, matchId: true },
      take: 200,
    }),
  ]);
  res.json({
    data: {
      profile,
      stats,
      rank,
      active: active.map(toMatchListItem),
      upcoming: upcoming.map(toMatchListItem),
      recent: recent.map(toMatchListItem),
      invitations,
      tournaments,
      ratingHistory,
    },
  });
});

/** Public profile. Private profiles are visible only to signed-in users. */
playerRouter.get('/:id', async (req, res) => {
  const id = idParam(req.params);
  const user = await prisma.user.findUnique({ where: { id }, select: { ...publicUserSelect, profilePublic: true, accountStatus: true } });
  if (!user || user.role !== 'PLAYER') throw notFound('Player');
  if (!user.profilePublic && !req.auth) throw forbidden('This profile is private');
  const { accountStatus: _s, ...rest } = user;
  res.json({ data: { ...rest, stats: await statsForOne(id), rank: await rankOf(id) } });
});

playerRouter.get('/:id/stats', async (req, res) => {
  res.json({ data: await statsForOne(idParam(req.params)) });
});

/** A player's finished public games; the player themself also sees their private ones. */
playerRouter.get('/:id/matches', async (req, res) => {
  const id = idParam(req.params);
  const page = validate(paginationSchema, req.query);
  const self = req.auth?.user.id === id || req.auth?.user.role === 'ADMIN';
  const where = {
    OR: [{ whitePlayerId: id }, { blackPlayerId: id }],
    status: { in: ['COMPLETED' as const, 'ABANDONED' as const, 'DISPUTED' as const] },
    isBye: false,
    ...(self ? {} : { isPrivate: false }),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.match.count({ where }),
    prisma.match.findMany({ where, select: matchListSelect, orderBy: [{ completedAt: 'desc' }, { id: 'asc' }], ...toSkipTake(page) }),
  ]);
  res.json({ data: rows.map(toMatchListItem), meta: pageMeta(page, total) });
});
