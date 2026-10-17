import type { MatchResult } from '@prisma/client';
import type { Tx } from '../../lib/prisma.js';
import { computeElo } from './elo.js';

const scoreFor = (result: MatchResult): 0 | 0.5 | 1 | null =>
  result === 'WHITE_WIN' ? 1 : result === 'BLACK_WIN' ? 0 : result === 'DRAW' ? 0.5 : null;

async function ratedGamesCount(tx: Tx, playerId: string) {
  return tx.ratingHistory.count({ where: { playerId, reversed: false } });
}

/**
 * Applies Elo changes for a finalized rated match. Must run inside the finalization transaction.
 * Idempotent: the unique (matchId, playerId) check means a second call is a no-op.
 */
export async function applyRatings(
  tx: Tx,
  match: { id: string; whitePlayerId: string; blackPlayerId: string; result: MatchResult },
) {
  const score = scoreFor(match.result);
  if (score === null) return null;

  const existing = await tx.ratingHistory.count({ where: { matchId: match.id, reversed: false } });
  if (existing > 0) return null;

  // Lock both profiles in a stable order to avoid deadlocks between concurrent finalizations.
  const ids = [match.whitePlayerId, match.blackPlayerId].sort();
  await tx.$queryRaw`SELECT id FROM "PlayerProfile" WHERE "userId" IN (${ids[0]}, ${ids[1]}) ORDER BY "userId" FOR UPDATE`;

  const [white, black] = await Promise.all([
    tx.playerProfile.findUniqueOrThrow({ where: { userId: match.whitePlayerId } }),
    tx.playerProfile.findUniqueOrThrow({ where: { userId: match.blackPlayerId } }),
  ]);
  const [wGames, bGames] = await Promise.all([
    ratedGamesCount(tx, match.whitePlayerId),
    ratedGamesCount(tx, match.blackPlayerId),
  ]);
  const next = computeElo(
    { rating: white.rating, ratedGames: wGames },
    { rating: black.rating, ratedGames: bGames },
    score,
  );

  for (const [profile, after] of [
    [white, next.white],
    [black, next.black],
  ] as const) {
    await tx.playerProfile.update({
      where: { userId: profile.userId },
      data: { rating: after, peakRating: Math.max(profile.peakRating, after) },
    });
    await tx.ratingHistory.create({
      data: {
        playerId: profile.userId,
        matchId: match.id,
        ratingBefore: profile.rating,
        ratingAfter: after,
        ratingChange: after - profile.rating,
      },
    });
  }
  return { white: { before: white.rating, after: next.white }, black: { before: black.rating, after: next.black } };
}

/** Reverses a match's rating changes (used when an admin corrects a disputed result). */
export async function reverseRatings(tx: Tx, matchId: string) {
  const entries = await tx.ratingHistory.findMany({ where: { matchId, reversed: false } });
  for (const e of entries) {
    await tx.playerProfile.update({
      where: { userId: e.playerId },
      data: { rating: { decrement: e.ratingChange } },
    });
    await tx.ratingHistory.update({ where: { id: e.id }, data: { reversed: true } });
  }
  return entries.length;
}
