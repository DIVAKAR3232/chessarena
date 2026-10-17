import { performance } from 'node:perf_hooks';

/**
 * Turn timing.
 *
 * The authoritative start of the current turn is persisted as `turnStartedAt` (wall clock) so it
 * survives restarts. While the process is alive we also keep a monotonic anchor
 * (performance.now()) captured when the turn started, keyed by match id + position version, so a
 * system clock adjustment cannot add or remove time from a running turn.
 */
interface Anchor {
  version: number;
  mono: number;
}

const anchors = new Map<string, Anchor>();

export function anchorTurn(matchId: string, version: number) {
  anchors.set(matchId, { version, mono: performance.now() });
}

export function clearAnchor(matchId: string) {
  anchors.delete(matchId);
}

/** Milliseconds elapsed in the current turn. */
export function elapsedInTurn(
  matchId: string,
  version: number,
  turnStartedAt: Date | null,
  now: number = Date.now(),
): number {
  const a = anchors.get(matchId);
  if (a && a.version === version) return Math.max(0, Math.round(performance.now() - a.mono));
  if (!turnStartedAt) return 0;
  return Math.max(0, now - turnStartedAt.getTime());
}

export interface ClockState {
  whiteMs: number;
  blackMs: number;
  /** Colour whose clock is running, or null when no clock runs. */
  running: 'w' | 'b' | null;
}

/** Live clock values (remaining minus elapsed for the side to move). */
export function liveClocks(m: {
  id: string;
  status: string;
  positionVersion: number;
  currentTurn: 'WHITE' | 'BLACK';
  whiteTimeRemainingMs: number;
  blackTimeRemainingMs: number;
  turnStartedAt: Date | null;
}): ClockState {
  if (m.status !== 'IN_PROGRESS') {
    return { whiteMs: m.whiteTimeRemainingMs, blackMs: m.blackTimeRemainingMs, running: null };
  }
  const elapsed = elapsedInTurn(m.id, m.positionVersion, m.turnStartedAt);
  return m.currentTurn === 'WHITE'
    ? { whiteMs: Math.max(0, m.whiteTimeRemainingMs - elapsed), blackMs: m.blackTimeRemainingMs, running: 'w' }
    : { whiteMs: m.whiteTimeRemainingMs, blackMs: Math.max(0, m.blackTimeRemainingMs - elapsed), running: 'b' };
}
