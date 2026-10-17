/**
 * Server-side deadline timers. These only *trigger* checks; every check re-reads the database
 * inside a transaction before changing anything, so a spurious or late timer is harmless.
 * On boot, all in-progress matches are rescheduled (see jobs.ts).
 */
const flagTimers = new Map<string, NodeJS.Timeout>();
const abandonTimers = new Map<string, NodeJS.Timeout>();

// setTimeout overflows above ~24.8 days; clocks never get near that, but clamp defensively.
const MAX_DELAY = 2_000_000_000;

export function scheduleFlag(matchId: string, delayMs: number, fn: () => void) {
  cancelFlag(matchId);
  const t = setTimeout(fn, Math.min(MAX_DELAY, Math.max(0, delayMs) + 25));
  t.unref?.();
  flagTimers.set(matchId, t);
}

export function cancelFlag(matchId: string) {
  const t = flagTimers.get(matchId);
  if (t) clearTimeout(t);
  flagTimers.delete(matchId);
}

const abandonKey = (matchId: string, userId: string) => `${matchId}:${userId}`;

export function scheduleAbandon(matchId: string, userId: string, delayMs: number, fn: () => void) {
  cancelAbandon(matchId, userId);
  const t = setTimeout(fn, delayMs);
  t.unref?.();
  abandonTimers.set(abandonKey(matchId, userId), t);
}

export function cancelAbandon(matchId: string, userId: string) {
  const key = abandonKey(matchId, userId);
  const t = abandonTimers.get(key);
  if (t) clearTimeout(t);
  abandonTimers.delete(key);
}

export function hasAbandonTimer(matchId: string, userId: string) {
  return abandonTimers.has(abandonKey(matchId, userId));
}

export function cancelAllTimers() {
  for (const t of flagTimers.values()) clearTimeout(t);
  for (const t of abandonTimers.values()) clearTimeout(t);
  flagTimers.clear();
  abandonTimers.clear();
}
