import type { MatchResult, MatchStatus } from '@prisma/client';
import type { Tx } from '../../lib/prisma.js';

export interface FinalizedMatchInfo {
  id: string;
  status: MatchStatus;
  result: MatchResult;
  tournamentId: string | null;
  roundId: string | null;
  whitePlayerId: string | null;
  blackPlayerId: string | null;
  winnerId: string | null;
}

/**
 * Hook run inside the finalization transaction (e.g. tournament advancement). May return a
 * callback to run after commit (e.g. notifications / socket events).
 */
export type FinalizeHook = (tx: Tx, match: FinalizedMatchInfo) => Promise<(() => void) | void>;

const hooks: FinalizeHook[] = [];

export function onMatchFinalized(hook: FinalizeHook) {
  hooks.push(hook);
}

export async function runFinalizeHooks(tx: Tx, match: FinalizedMatchInfo) {
  const after: (() => void)[] = [];
  for (const h of hooks) {
    const cb = await h(tx, match);
    if (cb) after.push(cb);
  }
  return after;
}
