import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { paginationSchema } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { validate } from '../../lib/validate.js';
import { getAuth, requireRole } from '../../middleware/auth.js';
import { listAudit } from '../admin/admin.service.js';
import { audit } from '../audit/audit.service.js';
import { listDisputes, listDisputesQuery } from '../disputes/dispute.service.js';
import { createAssignedMatchSchema, listMatchesQuery } from '../matches/match.schemas.js';
import { createAssignedMatch, listMatches } from '../matches/match.service.js';
import { matchListSelect, toMatchListItem } from '../matches/match.view.js';
import { notify } from '../notifications/notification.service.js';
import { generateNextRound } from '../tournaments/tournament.service.js';

export const coordinatorRouter = Router();
coordinatorRouter.use(requireRole('COORDINATOR', 'ADMIN'));

/** Matches a coordinator may supervise: ones they coordinate or in tournaments assigned to them. */
const scopeFor = (userId: string): Prisma.MatchWhereInput => ({
  OR: [{ coordinatorId: userId }, { tournament: { coordinators: { some: { coordinatorId: userId } } } }],
});

coordinatorRouter.get('/overview', async (req, res) => {
  const { user } = getAuth(req);
  const scope = scopeFor(user.id);
  const [tournaments, ongoing, upcoming, completed, counts, openDisputes, participants] = await Promise.all([
    prisma.tournament.findMany({
      where: { coordinators: { some: { coordinatorId: user.id } } },
      orderBy: [{ startsAt: { sort: 'asc', nulls: 'last' } }],
      include: { _count: { select: { participants: { where: { registrationStatus: { in: ['REGISTERED', 'ELIMINATED'] } } }, rounds: true } } },
    }),
    prisma.match.findMany({ where: { AND: [scope, { status: 'IN_PROGRESS' }] }, select: matchListSelect, take: 20 }),
    prisma.match.findMany({
      where: { AND: [scope, { status: { in: ['READY', 'WAITING'] } }] },
      select: matchListSelect,
      orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }],
      take: 20,
    }),
    prisma.match.findMany({
      where: { AND: [scope, { status: { in: ['COMPLETED', 'ABANDONED', 'DISPUTED'] } }, { isBye: false }] },
      select: matchListSelect,
      orderBy: { completedAt: 'desc' },
      take: 10,
    }),
    prisma.match.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] }, match: scope } }),
    prisma.tournamentParticipant.count({
      where: { registrationStatus: 'REGISTERED', tournament: { coordinators: { some: { coordinatorId: user.id } } } },
    }),
  ]);
  const tournamentIds = tournaments.map((t) => t.id);
  const recent = await listAudit({}, { page: 1, pageSize: 10 }, { OR: [{ actorId: user.id }, { resourceType: 'tournament', resourceId: { in: tournamentIds } }] });
  res.json({
    data: {
      tournaments,
      ongoing: ongoing.map(toMatchListItem),
      upcoming: upcoming.map(toMatchListItem),
      completed: completed.map(toMatchListItem),
      matchCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      openDisputes,
      participants,
      recentActivity: recent.items,
    },
  });
});

coordinatorRouter.get('/matches', async (req, res) => {
  const q = validate(listMatchesQuery, req.query);
  const { items, meta } = await listMatches(getAuth(req).user, { ...q, scope: 'mine' }, validate(paginationSchema, req.query));
  res.json({ data: items, meta });
});

coordinatorRouter.post('/matches', async (req, res) => {
  const input = validate(createAssignedMatchSchema, req.body);
  const match = await createAssignedMatch(getAuth(req).user, input);
  res.status(201).json({ data: { id: match.id, status: match.status } });
});

coordinatorRouter.post('/tournaments/:id/pairings', async (req, res) => {
  const { id } = validate(z.object({ id: z.string().min(1).max(40) }), req.params);
  res.status(201).json({ data: await generateNextRound(getAuth(req).user, id) });
});

coordinatorRouter.get('/disputes', async (req, res) => {
  const { status } = validate(listDisputesQuery, req.query);
  const { items, meta } = await listDisputes(getAuth(req).user, status, validate(paginationSchema, req.query));
  res.json({ data: items, meta });
});

/** Report suspected cheating, misconduct or a technical problem to the administrators. */
coordinatorRouter.post('/reports', async (req, res) => {
  const { user } = getAuth(req);
  const input = validate(
    z
      .object({
        kind: z.enum(['CHEATING', 'MISCONDUCT', 'TECHNICAL']),
        playerId: z.string().min(1).max(40).optional(),
        matchId: z.string().min(1).max(40).optional(),
        details: z.string().trim().min(10).max(2000),
      })
      .strict(),
    req.body,
  );
  if (input.matchId && !(await prisma.match.count({ where: { id: input.matchId } }))) throw notFound('Match');
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', accountStatus: 'ACTIVE' }, select: { id: true } });
  const { publish } = await prisma.$transaction(async (tx) => {
    await audit(
      { actorId: user.id, action: 'coordinator.report', resourceType: input.matchId ? 'match' : 'user', resourceId: input.matchId ?? input.playerId ?? null, details: input },
      tx,
    );
    return notify(
      admins.map((a) => ({
        recipientId: a.id,
        type: 'SYSTEM' as const,
        title: `${input.kind.toLowerCase()} report from ${user.displayName}`,
        message: input.details.slice(0, 1000),
        relatedMatchId: input.matchId ?? null,
      })),
      tx,
    );
  });
  publish();
  res.status(201).json({ data: { ok: true } });
});
