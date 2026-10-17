import { describe, expect, it } from 'vitest';
import { computeElo, expectedScore, kFactor } from './elo.js';

describe('Elo', () => {
  it('expected score is 0.5 for equal ratings and symmetric', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5);
    expect(expectedScore(1600, 1400) + expectedScore(1400, 1600)).toBeCloseTo(1);
  });

  it('uses the documented K-factor policy', () => {
    expect(kFactor(1200, 0)).toBe(40);
    expect(kFactor(1800, 30)).toBe(20);
    expect(kFactor(2450, 100)).toBe(10);
  });

  it('a win between new equal players moves ratings by 20 each way', () => {
    expect(computeElo({ rating: 1200, ratedGames: 0 }, { rating: 1200, ratedGames: 0 }, 1)).toEqual({
      white: 1220,
      black: 1180,
    });
  });

  it('a draw between equal players changes nothing', () => {
    expect(computeElo({ rating: 1500, ratedGames: 50 }, { rating: 1500, ratedGames: 50 }, 0.5)).toEqual({
      white: 1500,
      black: 1500,
    });
  });

  it('a draw against a stronger player gains rating', () => {
    const r = computeElo({ rating: 1400, ratedGames: 50 }, { rating: 1800, ratedGames: 50 }, 0.5);
    expect(r.white).toBeGreaterThan(1400);
    expect(r.black).toBeLessThan(1800);
  });
});
