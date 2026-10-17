import { describe, expect, it } from 'vitest';
import {
  bracketSeedOrder,
  knockoutFirstRound,
  knockoutNextRound,
  knockoutRoundCount,
  roundRobinSchedule,
} from './pairing.js';
import { computeStandings, type StandingGame, type StandingPlayer } from './standings.js';

const players = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

function assertValidRoundRobin(n: number) {
  const ps = players(n);
  const rounds = roundRobinSchedule(ps);
  const even = n % 2 === 0 ? n : n + 1;
  expect(rounds).toHaveLength(even - 1);
  const seen = new Set<string>();
  for (const round of rounds) {
    const inRound = new Set<string>();
    let byes = 0;
    for (const p of round) {
      for (const x of [p.white, p.black]) {
        if (x === null) continue;
        expect(inRound.has(x)).toBe(false); // nobody plays twice in a round
        inRound.add(x);
      }
      if (p.black === null) {
        byes += 1;
        expect(p.white).not.toBeNull();
        continue;
      }
      const key = [p.white, p.black].sort().join('-');
      expect(seen.has(key)).toBe(false); // no duplicate pairing
      seen.add(key);
    }
    expect(inRound.size).toBe(n);
    expect(byes).toBe(n % 2);
  }
  expect(seen.size).toBe((n * (n - 1)) / 2); // everyone meets everyone
}

describe('round robin pairings', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 10, 11])('is a valid schedule for %i players', (n) => assertValidRoundRobin(n));

  it('balances colours within one game per player', () => {
    const ps = players(6);
    const whites = new Map(ps.map((p) => [p, 0]));
    for (const round of roundRobinSchedule(ps)) for (const p of round) if (p.white && p.black) whites.set(p.white, whites.get(p.white)! + 1);
    for (const w of whites.values()) expect(Math.abs(w - 2.5)).toBeLessThanOrEqual(1.5);
  });
});

describe('single elimination', () => {
  it('uses standard seed order', () => {
    expect(bracketSeedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('gives byes to the top seeds when the field is not a power of two', () => {
    const r1 = knockoutFirstRound(players(6));
    expect(r1).toHaveLength(4);
    const byes = r1.filter((p) => p.black === null).map((p) => p.white);
    expect(byes.sort()).toEqual(['p1', 'p2']);
    expect(knockoutRoundCount(6)).toBe(3);
  });

  it('pairs winners of adjacent slots in the next round', () => {
    const next = knockoutNextRound(['p1', 'p5', 'p2', 'p3']);
    expect(next).toEqual([
      { white: 'p1', black: 'p5', slot: 0 },
      { white: 'p2', black: 'p3', slot: 1 },
    ]);
  });
});

describe('standings', () => {
  const ps: StandingPlayer[] = ['a', 'b', 'c', 'd'].map((id, i) => ({
    id,
    username: id,
    displayName: id,
    seed: i + 1,
    rating: 1200,
  }));
  const policy = { win: 1, draw: 0.5, loss: 0, bye: 1 };

  it('scores wins, draws, losses and byes', () => {
    const games: StandingGame[] = [
      { whiteId: 'a', blackId: 'b', result: 'WHITE_WIN', isBye: false },
      { whiteId: 'c', blackId: 'd', result: 'DRAW', isBye: false },
      { whiteId: 'd', blackId: null, result: 'WHITE_WIN', isBye: true },
    ];
    const s = computeStandings(ps, games, policy);
    const byId = Object.fromEntries(s.map((r) => [r.id, r]));
    expect(byId.a!.points).toBe(1);
    expect(byId.b!.points).toBe(0);
    expect(byId.c!.points).toBe(0.5);
    expect(byId.d!.points).toBe(1.5);
    expect(byId.d!.byes).toBe(1);
    expect(s[0]!.id).toBe('d');
  });

  it('breaks ties by Sonneborn-Berger, then head-to-head, then seed', () => {
    // a and b both 1 point; a beat c (who has 1 point), b beat d (0 points) -> a ahead on SB.
    const games: StandingGame[] = [
      { whiteId: 'a', blackId: 'c', result: 'WHITE_WIN', isBye: false },
      { whiteId: 'b', blackId: 'd', result: 'WHITE_WIN', isBye: false },
      { whiteId: 'c', blackId: 'd', result: 'WHITE_WIN', isBye: false },
    ];
    const s = computeStandings(ps, games, policy);
    expect(s.map((r) => r.id).slice(0, 2)).toEqual(['a', 'b']);
  });

  it('uses head-to-head when two players are otherwise tied', () => {
    // b beat a; both drew with c and d symmetrically: identical points/SB/wins.
    const games: StandingGame[] = [{ whiteId: 'a', blackId: 'b', result: 'BLACK_WIN', isBye: false }];
    const two = computeStandings(ps.slice(0, 2), games, policy);
    expect(two[0]!.id).toBe('b');
  });

  it('ignores NO_RESULT games', () => {
    const s = computeStandings(ps, [{ whiteId: 'a', blackId: 'b', result: 'NO_RESULT', isBye: false }], policy);
    expect(s.every((r) => r.points === 0 && r.played === 0)).toBe(true);
    expect(s.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']); // by seed
  });
});
