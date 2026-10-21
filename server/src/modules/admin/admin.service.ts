import type { AccountStatus, Prisma, Role } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { pageMeta, toSkipTake, type Pagination } from '../../lib/pagination.js';
import { advisoryLock, prisma, type Tx } from '../../lib/prisma.js';
import type { Actor } from '../../policies/index.js';
import { disconnectUser } from '../../socket/index.js';
import { audit } from '../audit/audit.service.js';
import { forgotPassword, revokeAllSessions } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import { matchListSelect, toMatchListItem } from '../matches/match.view.js';
import { statsForOne } from '../players/stats.service.js';
import { announceLeaderboardChange, getIo } from '../realtime/emitter.js';
import { privateUserSelect } from '../users/user.mapper.js';

export async function overview() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const [
    players,
    coordinators,
    admins,
    suspended,
    disabled,
    activeMatches,
    readyMatches,
    completedMatches,
    completedThisWeek,
    upcomingTournaments,
    tournamentsByStatus,
    openDisputes,
    recentActivity,
    completedRecent,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'PLAYER' } }),
    prisma.user.count({ where: { role: 'COORDINATOR' } }),
    prisma.user.count({ where: { role: 'ADMIN', accountStatus: 'ACTIVE' } }),
    prisma.user.count({ where: { accountStatus: 'SUSPENDED' } }),
    prisma.user.count({ where: { accountStatus: 'DISABLED' } }),
    prisma.match.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.match.count({ where: { status: { in: ['READY', 'WAITING'] } } }),
    prisma.match.count({ where: { status: { in: ['COMPLETED', 'ABANDONED'] }, isBye: false } }),
    prisma.match.count({ where: { status: { in: ['COMPLETED', 'ABANDONED'] }, isBye: false, completedAt: { gte: weekAgo } } }),
    prisma.tournament.count({ where: { status: { in: ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] } } }),
    prisma.tournament.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, action: true, resourceType: true, resourceId: true, createdAt: true, actor: { select: { id: true, username: true, displayName: true } } },
    }),
    prisma.match.findMany({
      where: { status: { in: ['COMPLETED', 'ABANDONED'] }, isBye: false, completedAt: { gte: weekAgo } },
      select: { completedAt: true, result: true },
    }),
  ]);

  // Games finished per day over the last 7 days (oldest first).
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now.getTime() - (6 - i) * 24 * 60 * 60_000);
    return { date: day.toISOString().slice(0, 10), games: 0 };
  });
  for (const m of completedRecent) {
    const key = m.completedAt!.toISOString().slice(0, 10);
    const slot = perDay.find((d) => d.date === key);
    if (slot) slot.games += 1;
  }

  return {
    users: { players, coordinators, admins, suspended, disabled },
    matches: { active: activeMatches, scheduled: readyMatches, completed: completedMatches, completedThisWeek, perDay },
    tournaments: {
      upcoming: upcomingTournaments,
      byStatus: Object.fromEntries(tournamentsByStatus.map((g) => [g.status, g._count._all])),
    },
    openDisputes,
    recentActivity,
  };
}

export interface UserQuery {
  search?: string;
  role?: Role;
  status?: AccountStatus;
  sort: 'createdAt' | 'lastLoginAt' | 'username';
  order: 'asc' | 'desc';
}

export async function listUsers(q: UserQuery, page: Pagination) {
  const where: Prisma.UserWhereInput = {
    ...(q.role ? { role: q.role } : {}),
    ...(q.status ? { accountStatus: q.status } : {}),
    ...(q.search
      ? {
          OR: [
            { username: { contains: q.search.toLowerCase() } },
            { email: { contains: q.search.toLowerCase() } },
            { displayName: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.UserOrderByWithRelationInput =
    q.sort === 'lastLoginAt' ? { lastLoginAt: { sort: q.order, nulls: 'last' } } : { [q.sort]: q.order };
  const [total, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select: privateUserSelect, orderBy: [orderBy, { id: 'asc' }], ...toSkipTake(page) }),
  ]);
  return { items, meta: pageMeta(page, total) };
}

export async function userDetail(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: privateUserSelect });
  if (!user) throw notFound('User');
  const [stats, recentMatches, activeSessions, audits] = await Promise.all([
    user.role === 'PLAYER' ? statsForOne(id) : null,
    prisma.match.findMany({
      where: { OR: [{ whitePlayerId: id }, { blackPlayerId: id }] },
      select: matchListSelect,
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.auditLog.findMany({
      where: { OR: [{ actorId: id }, { resourceType: 'user', resourceId: id }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, action: true, resourceType: true, resourceId: true, details: true, createdAt: true, actor: { select: { username: true } } },
    }),
  ]);
  return { user, stats, recentMatches: recentMatches.map(toMatchListItem), activeSessions, audits };
}

export async function createCoordinator(
  admin: Actor,
  input: { displayName: string; username: string; email: string; password: string },
) {
  return createUser(admin, { ...input, role: 'COORDINATOR' });
}

/** Admin-created accounts of any role (email treated as verified: a trusted admin created it). */
export async function createUser(
  admin: Actor,
  input: { displayName: string; username: string; email: string; password: string; role: Role },
) {
  const exists = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, { username: input.username }] }, select: { email: true } });
  if (exists) throw conflict(exists.email === input.email ? 'This email is already registered' : 'This username is taken');
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        displayName: input.displayName,
        username: input.username,
        email: input.email,
        passwordHash,
        role: input.role,
        // Created by a trusted admin; no self-service verification step.
        emailVerifiedAt: new Date(),
        ...(input.role === 'PLAYER' ? { profile: { create: {} } } : {}),
      },
      select: privateUserSelect,
    });
    await audit(
      {
        actorId: admin.id,
        action: input.role === 'COORDINATOR' ? 'admin.create_coordinator' : 'admin.create_user',
        resourceType: 'user',
        resourceId: user.id,
        details: { username: user.username, role: input.role },
      },
      tx,
    );
    return user;
  });
}

/**
 * Removes a user. Accounts without any game or tournament history are deleted permanently.
 * Accounts with history are deactivated instead (DISABLED, signed out, hidden from the
 * leaderboard): deleting them would corrupt opponents' match records and ratings.
 */
export async function removeUser(admin: Actor, userId: string, reason: string) {
  if (admin.id === userId) throw forbidden('You cannot remove your own account');
  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, username: true, role: true, accountStatus: true } });
    if (!target) throw notFound('User');
    await assertNotLastAdmin(tx, userId);

    const [matches, moves, invitations, disputes, tournaments, announcements, participations] = await Promise.all([
      tx.match.count({
        where: { OR: [{ whitePlayerId: userId }, { blackPlayerId: userId }, { createdById: userId }, { coordinatorId: userId }, { winnerId: userId }] },
      }),
      tx.gameMove.count({ where: { playerId: userId } }),
      tx.matchInvitation.count({ where: { OR: [{ inviterId: userId }, { inviteeId: userId }] } }),
      tx.dispute.count({ where: { OR: [{ submittedByPlayerId: userId }, { resolvedByAdminId: userId }] } }),
      tx.tournament.count({ where: { OR: [{ createdById: userId }, { winnerId: userId }] } }),
      tx.announcement.count({ where: { authorId: userId } }),
      tx.tournamentParticipant.count({ where: { playerId: userId } }),
    ]);
    const hasHistory = matches + moves + invitations + disputes + tournaments + announcements + participations > 0;

    if (hasHistory) {
      await revokeAllSessions(userId, tx);
      await tx.matchmakingQueueEntry.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { accountStatus: 'DISABLED', profilePublic: false } });
      await audit({ actorId: admin.id, action: 'admin.remove_user', resourceType: 'user', resourceId: userId, details: { username: target.username, mode: 'deactivated', reason } }, tx);
      return { mode: 'deactivated' as const, username: target.username };
    }
    // Sessions, tokens, profile, notifications and rating history cascade; audit rows keep a null actor.
    await tx.user.delete({ where: { id: userId } });
    await audit({ actorId: admin.id, action: 'admin.remove_user', resourceType: 'user', resourceId: userId, details: { username: target.username, mode: 'deleted', reason } }, tx);
    return { mode: 'deleted' as const, username: target.username };
  });
  disconnectUser(getIo(), userId);
  announceLeaderboardChange();
  return result;
}

/** Locks admin-count checks so two concurrent demotions cannot remove the last admin. */
async function assertNotLastAdmin(tx: Tx, userId: string) {
  await advisoryLock(tx, 'admin-roster');
  const target = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, accountStatus: true } });
  if (target.role !== 'ADMIN' || target.accountStatus !== 'ACTIVE') return;
  const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', accountStatus: 'ACTIVE' } });
  if (activeAdmins <= 1) throw conflict('This is the last active administrator and cannot be demoted or deactivated');
}

export async function changeRole(admin: Actor, userId: string, role: Role) {
  if (admin.id === userId) throw forbidden('You cannot change your own role');
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!before) throw notFound('User');
    if (before.role === role) throw badRequest(`User is already ${role.toLowerCase()}`);
    if (before.role === 'ADMIN') await assertNotLastAdmin(tx, userId);
    if (role === 'PLAYER') {
      await tx.playerProfile.upsert({ where: { userId }, create: { userId }, update: {} });
    } else {
      // Operational accounts cannot sit in queues or hold open challenges.
      await tx.matchmakingQueueEntry.deleteMany({ where: { userId } });
    }
    const u = await tx.user.update({ where: { id: userId }, data: { role }, select: privateUserSelect });
    await revokeAllSessions(userId, tx);
    await audit({ actorId: admin.id, action: 'admin.change_role', resourceType: 'user', resourceId: userId, details: { from: before.role, to: role } }, tx);
    return u;
  });
  disconnectUser(getIo(), userId);
  announceLeaderboardChange();
  return updated;
}

export async function changeStatus(admin: Actor, userId: string, status: AccountStatus, reason: string) {
  if (admin.id === userId) throw forbidden('You cannot change the status of your own account');
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: { accountStatus: true } });
    if (!before) throw notFound('User');
    if (before.accountStatus === status) throw badRequest(`Account is already ${status.toLowerCase()}`);
    if (status !== 'ACTIVE') {
      await assertNotLastAdmin(tx, userId);
      await revokeAllSessions(userId, tx);
      await tx.matchmakingQueueEntry.deleteMany({ where: { userId } });
    }
    const u = await tx.user.update({ where: { id: userId }, data: { accountStatus: status }, select: privateUserSelect });
    await audit({ actorId: admin.id, action: 'admin.change_status', resourceType: 'user', resourceId: userId, details: { from: before.accountStatus, to: status, reason } }, tx);
    return u;
  });
  if (status !== 'ACTIVE') disconnectUser(getIo(), userId);
  announceLeaderboardChange();
  return updated;
}

/** Sends the user a reset link; admins never see or set passwords. */
export async function initiatePasswordReset(admin: Actor, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw notFound('User');
  await forgotPassword(user.email, admin.id);
  await audit({ actorId: admin.id, action: 'admin.password_reset', resourceType: 'user', resourceId: userId });
}

export interface AuditQuery {
  action?: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
}

export async function listAudit(q: AuditQuery, page: Pagination, scope?: Prisma.AuditLogWhereInput) {
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      q.action ? { action: { startsWith: q.action } } : {},
      q.resourceType ? { resourceType: q.resourceType } : {},
      q.resourceId ? { resourceId: q.resourceId } : {},
      q.actorId ? { actorId: q.actorId } : {},
      scope ?? {},
    ],
  };
  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      ...toSkipTake(page),
      select: { id: true, action: true, resourceType: true, resourceId: true, details: true, createdAt: true, actor: { select: { id: true, username: true, displayName: true, role: true } } },
    }),
  ]);
  return { items, meta: pageMeta(page, total) };
}
