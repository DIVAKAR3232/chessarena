/**
 * Centralized authorization policies, shared by HTTP controllers and Socket.IO handlers.
 * Route-level role checks live in middleware/auth.ts (requireRole); everything resource-specific
 * is decided here.
 */
import type { MatchStatus, Role } from '@prisma/client';
import { forbidden } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

export interface Actor {
  id: string;
  role: Role;
  displayName?: string;
}

export interface MatchAccessInfo {
  whitePlayerId: string | null;
  blackPlayerId: string | null;
  coordinatorId: string | null;
  tournamentId: string | null;
  createdById: string;
  isPrivate: boolean;
  status: MatchStatus;
}

export async function isAssignedCoordinator(coordinatorId: string, tournamentId: string): Promise<boolean> {
  const a = await prisma.coordinatorAssignment.findUnique({
    where: { coordinatorId_tournamentId: { coordinatorId, tournamentId } },
    select: { id: true },
  });
  return Boolean(a);
}

export function isParticipant(actor: Actor, m: Pick<MatchAccessInfo, 'whitePlayerId' | 'blackPlayerId'>) {
  return actor.role === 'PLAYER' && (m.whitePlayerId === actor.id || m.blackPlayerId === actor.id);
}

/** Admins and coordinators of the match/tournament may observe (never act on) a game. */
export async function canSuperviseMatch(actor: Actor, m: MatchAccessInfo): Promise<boolean> {
  if (actor.role === 'ADMIN') return true;
  if (actor.role !== 'COORDINATOR') return false;
  if (m.coordinatorId === actor.id) return true;
  if (m.tournamentId) return isAssignedCoordinator(actor.id, m.tournamentId);
  return false;
}

/**
 * Who may read a match:
 *  - its two participants;
 *  - admins, and coordinators assigned to it (read-only supervision);
 *  - any authenticated user for a public match that has finished (replay), or an open public
 *    challenge waiting for an opponent (lobby).
 */
export async function canViewMatch(actor: Actor | null, m: MatchAccessInfo): Promise<boolean> {
  if (actor && (isParticipant(actor, m) || m.createdById === actor.id)) return true;
  if (actor && (await canSuperviseMatch(actor, m))) return true;
  if (m.isPrivate) return false;
  if (m.status === 'COMPLETED' || m.status === 'ABANDONED') return true;
  if (m.status === 'CREATED' && actor?.role === 'PLAYER') return true;
  return false;
}

export async function assertCanViewMatch(actor: Actor | null, m: MatchAccessInfo) {
  if (!(await canViewMatch(actor, m))) throw forbidden('You are not allowed to view this match');
}

/** Tournament management: admins, or coordinators assigned to the tournament. */
export async function canManageTournament(actor: Actor, tournamentId: string): Promise<boolean> {
  if (actor.role === 'ADMIN') return true;
  if (actor.role === 'COORDINATOR') return isAssignedCoordinator(actor.id, tournamentId);
  return false;
}

export async function assertCanManageTournament(actor: Actor, tournamentId: string) {
  if (!(await canManageTournament(actor, tournamentId))) {
    throw forbidden('You are not assigned to manage this tournament');
  }
}

/** Cancelling a not-yet-started match. */
export async function canCancelMatch(actor: Actor, m: MatchAccessInfo): Promise<boolean> {
  if (actor.role === 'ADMIN') return true;
  if (actor.role === 'COORDINATOR') return canSuperviseMatch(actor, m);
  // Players may cancel their own challenges and decline/withdraw from non-tournament games.
  return !m.tournamentId && (m.createdById === actor.id || isParticipant(actor, m));
}
