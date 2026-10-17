/**
 * Pure standings calculation.
 *
 * Scoring is configurable per tournament (default win 1, draw 0.5, loss 0, bye 1).
 * Tie-break order (documented):
 *   1. points
 *   2. Sonneborn–Berger (sum of points of opponents beaten + half the points of opponents drawn)
 *   3. number of wins (byes excluded)
 *   4. head-to-head score (applied when exactly two players remain tied)
 *   5. seed (lower is better), then username
 */
import type { MatchResult } from '@prisma/client';

export interface ScoringPolicy {
  win: number;
  draw: number;
  loss: number;
  bye: number;
}

export interface StandingPlayer {
  id: string;
  username: string;
  displayName: string;
  seed: number | null;
  rating: number | null;
}

export interface StandingGame {
  whiteId: string | null;
  blackId: string | null;
  result: MatchResult;
  isBye: boolean;
}

export interface StandingRow extends StandingPlayer {
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  byes: number;
  points: number;
  sonnebornBerger: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeStandings(
  players: readonly StandingPlayer[],
  games: readonly StandingGame[],
  policy: ScoringPolicy,
): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    players.map((p) => [
      p.id,
      { ...p, rank: 0, played: 0, wins: 0, draws: 0, losses: 0, byes: 0, points: 0, sonnebornBerger: 0 },
    ]),
  );
  // Per-pair score for head-to-head and SB.
  const scores: { a: string; b: string; scoreA: number }[] = [];

  for (const g of games) {
    if (g.result === 'NO_RESULT') continue;
    if (g.isBye) {
      const id = g.whiteId ?? g.blackId;
      const r = id ? rows.get(id) : undefined;
      if (r) {
        r.byes += 1;
        r.points += policy.bye;
      }
      continue;
    }
    if (!g.whiteId || !g.blackId) continue;
    const w = rows.get(g.whiteId);
    const b = rows.get(g.blackId);
    if (!w || !b) continue;
    w.played += 1;
    b.played += 1;
    let whiteScore: number;
    if (g.result === 'WHITE_WIN') {
      w.wins += 1;
      b.losses += 1;
      w.points += policy.win;
      b.points += policy.loss;
      whiteScore = 1;
    } else if (g.result === 'BLACK_WIN') {
      b.wins += 1;
      w.losses += 1;
      b.points += policy.win;
      w.points += policy.loss;
      whiteScore = 0;
    } else {
      w.draws += 1;
      b.draws += 1;
      w.points += policy.draw;
      b.points += policy.draw;
      whiteScore = 0.5;
    }
    scores.push({ a: g.whiteId, b: g.blackId, scoreA: whiteScore });
  }

  for (const s of scores) {
    const a = rows.get(s.a)!;
    const b = rows.get(s.b)!;
    a.sonnebornBerger += s.scoreA * b.points;
    b.sonnebornBerger += (1 - s.scoreA) * a.points;
  }
  for (const r of rows.values()) {
    r.points = round2(r.points);
    r.sonnebornBerger = round2(r.sonnebornBerger);
  }

  const headToHead = (x: string, y: string) => {
    let sx = 0;
    let sy = 0;
    for (const s of scores) {
      if (s.a === x && s.b === y) {
        sx += s.scoreA;
        sy += 1 - s.scoreA;
      } else if (s.a === y && s.b === x) {
        sy += s.scoreA;
        sx += 1 - s.scoreA;
      }
    }
    return sx - sy;
  };

  const primary = (a: StandingRow, b: StandingRow) =>
    b.points - a.points || b.sonnebornBerger - a.sonnebornBerger || b.wins - a.wins;
  const final = (a: StandingRow, b: StandingRow) =>
    (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) || a.username.localeCompare(b.username);

  const sorted = [...rows.values()].sort((a, b) => primary(a, b) || final(a, b));

  // Head-to-head for groups of exactly two tied on the primary criteria.
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const tiedWithPrev = i > 0 && primary(sorted[i - 1]!, a) === 0;
    const tiedWithNext = i + 2 < sorted.length && primary(b, sorted[i + 2]!) === 0;
    if (primary(a, b) === 0 && !tiedWithPrev && !tiedWithNext && headToHead(a.id, b.id) < 0) {
      sorted[i] = b;
      sorted[i + 1] = a;
    }
  }

  // Shared ranks only when completely indistinguishable is avoided: ranks are positional.
  sorted.forEach((r, idx) => (r.rank = idx + 1));
  return sorted;
}
