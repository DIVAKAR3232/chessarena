/**
 * Elo rating policy (documented in docs/ARCHITECTURE.md §8).
 *  - Initial rating 1200.
 *  - K = 40 while a player has fewer than 30 rated games, 20 below 2400, 10 at or above 2400.
 *  - Expected score E = 1 / (1 + 10^((Ropp - R) / 400)).
 *  - New rating = round(R + K * (S - E)), S in {1, 0.5, 0}. Floor of 100.
 */
export const INITIAL_RATING = 1200;
export const RATING_FLOOR = 100;

export function kFactor(rating: number, ratedGames: number): number {
  if (ratedGames < 30) return 40;
  if (rating < 2400) return 20;
  return 10;
}

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export interface EloInput {
  rating: number;
  ratedGames: number;
}

/** Returns new ratings for white and black given white's score (1, 0.5 or 0). */
export function computeElo(white: EloInput, black: EloInput, whiteScore: 0 | 0.5 | 1) {
  const ew = expectedScore(white.rating, black.rating);
  const eb = 1 - ew;
  const blackScore = 1 - whiteScore;
  const newWhite = Math.max(
    RATING_FLOOR,
    Math.round(white.rating + kFactor(white.rating, white.ratedGames) * (whiteScore - ew)),
  );
  const newBlack = Math.max(
    RATING_FLOOR,
    Math.round(black.rating + kFactor(black.rating, black.ratedGames) * (blackScore - eb)),
  );
  return { white: newWhite, black: newBlack };
}
