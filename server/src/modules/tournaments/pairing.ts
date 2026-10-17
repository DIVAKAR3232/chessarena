/**
 * Pure pairing algorithms (no database access).
 *
 * Round robin: circle method (Berger tables). With an odd number of players a BYE (null) is
 * added; each round, the player paired with the BYE sits out. Every pair of players meets exactly
 * once over n-1 rounds (n = even player count), and colours alternate as evenly as the method
 * allows.
 *
 * Single elimination: players are seeded into a bracket whose size is the next power of two using
 * standard seeding (1 v 16, 8 v 9, ...). Empty slots become byes, so the top seeds get them.
 */

export interface Pairing<T> {
  white: T | null;
  black: T | null;
  /** Index of the pairing within the round (board number / bracket slot). */
  slot: number;
}

/** Returns all n-1 rounds of a round robin for `players` (in seed order). */
export function roundRobinSchedule<T>(players: readonly T[]): Pairing<T>[][] {
  if (players.length < 2) return [];
  const list: (T | null)[] = [...players];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds: Pairing<T>[][] = [];
  const fixed = list[0]!;
  let rotating = list.slice(1);
  // Colour balancing: white goes to whoever has had fewer whites, then to whoever had black last.
  const whites = new Map<T, number>();
  const lastWhite = new Map<T, boolean>();

  for (let r = 0; r < n - 1; r++) {
    const current = [fixed, ...rotating];
    const round: Pairing<T>[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = current[i] ?? null;
      const b = current[n - 1 - i] ?? null;
      let aWhite: boolean;
      if (a === null || b === null) {
        aWhite = a !== null;
      } else {
        const wa = whites.get(a) ?? 0;
        const wb = whites.get(b) ?? 0;
        if (wa !== wb) aWhite = wa < wb;
        else if (lastWhite.get(a) !== lastWhite.get(b)) aWhite = lastWhite.get(a) !== true;
        else aWhite = (i + r) % 2 === 0;
        const white = aWhite ? a : b;
        const black = aWhite ? b : a;
        whites.set(white, (whites.get(white) ?? 0) + 1);
        lastWhite.set(white, true);
        lastWhite.set(black, false);
      }
      round.push({ white: aWhite ? a : b, black: aWhite ? b : a, slot: i });
    }
    rounds.push(round);
    // Rotate clockwise: last element moves to the front of the rotating part.
    rotating = [rotating[rotating.length - 1]!, ...rotating.slice(0, -1)];
  }
  // A bye is always represented with the real player as "white".
  return rounds.map((round) =>
    round.map((p) => (p.white === null && p.black !== null ? { white: p.black, black: null, slot: p.slot } : p)),
  );
}

export const nextPowerOfTwo = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/** Standard bracket seed order for a bracket of `size` (power of two): [1, 16, 8, 9, ...]. */
export function bracketSeedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((s) => [s, next - s]);
  }
  return order;
}

/** First knockout round. `players` must be ordered by seed (index 0 = seed 1). */
export function knockoutFirstRound<T>(players: readonly T[]): Pairing<T>[] {
  if (players.length < 2) return [];
  const size = nextPowerOfTwo(players.length);
  const order = bracketSeedOrder(size);
  const pairings: Pairing<T>[] = [];
  for (let i = 0; i < size; i += 2) {
    const a = players[order[i]! - 1] ?? null;
    const b = players[order[i + 1]! - 1] ?? null;
    // Higher seed takes white in round one; a missing opponent means a bye.
    pairings.push({ white: a ?? b, black: a ? b : null, slot: i / 2 });
  }
  return pairings;
}

/** Next knockout round from the previous round's winners (indexed by slot). */
export function knockoutNextRound<T>(winnersBySlot: readonly (T | null)[]): Pairing<T>[] {
  const pairings: Pairing<T>[] = [];
  for (let i = 0; i < winnersBySlot.length; i += 2) {
    const a = winnersBySlot[i] ?? null;
    const b = winnersBySlot[i + 1] ?? null;
    pairings.push({ white: a ?? b, black: a ? b : null, slot: i / 2 });
  }
  return pairings;
}

export const knockoutRoundCount = (players: number) => Math.log2(nextPowerOfTwo(players));
