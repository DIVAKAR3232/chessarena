import type { MatchStatus } from '@prisma/client';
import { invalidState } from '../../lib/errors.js';

/**
 * Match lifecycle (see docs/ARCHITECTURE.md §5):
 *
 *   CREATED      open challenge, one seat still empty
 *   WAITING      both seats named, waiting for the invitee to accept
 *   READY        both participants confirmed; starts when both have joined the board
 *   IN_PROGRESS  clocks running
 *   COMPLETED    final result recorded (exactly once)
 *   ABANDONED    a participant failed to return within the reconnection grace period
 *   CANCELLED    cancelled before it started (or invitation expired / declined)
 *   DISPUTED     result under administrative review
 */
export const TRANSITIONS: Readonly<Record<MatchStatus, readonly MatchStatus[]>> = {
  CREATED: ['WAITING', 'READY', 'CANCELLED'],
  WAITING: ['READY', 'CANCELLED'],
  READY: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'ABANDONED'],
  COMPLETED: ['DISPUTED'],
  ABANDONED: ['DISPUTED'],
  DISPUTED: ['COMPLETED', 'ABANDONED'],
  CANCELLED: [],
};

export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: MatchStatus, to: MatchStatus): void {
  if (!canTransition(from, to)) {
    throw invalidState(`Match cannot move from ${from} to ${to}`);
  }
}

export const PRE_START_STATUSES: readonly MatchStatus[] = ['CREATED', 'WAITING', 'READY'];
export const FINISHED_STATUSES: readonly MatchStatus[] = ['COMPLETED', 'ABANDONED', 'CANCELLED', 'DISPUTED'];
