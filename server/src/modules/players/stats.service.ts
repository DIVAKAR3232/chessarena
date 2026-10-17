/**
 * Player statistics are always computed from finished Match rows (single source of truth).
 * Byes and NO_RESULT games are excluded.
 */
import { prisma } from '../../lib/prisma.js';

export interface PlayerStats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
}

const empty = (): PlayerStats => ({ games: 0, wins: 0, draws: 0, losses: 0, winRate: 0 });

export async function statsFor(userIds: string[]): Promise<Map<string, PlayerStats>> {
  const out = new Map<string, PlayerStats>(userIds.map((id) => [id, empty()]));
  if (userIds.length === 0) return out;
  const rows = await prisma.$queryRaw<{ userId: string; games: number; wins: number; draws: number; losses: number }[]>`
    SELECT u.id AS "userId",
      COUNT(m.id)::int AS games,
      COUNT(*) FILTER (WHERE m."winnerId" = u.id)::int AS wins,
      COUNT(*) FILTER (WHERE m.result = 'DRAW')::int AS draws,
      COUNT(*) FILTER (WHERE m."winnerId" IS NOT NULL AND m."winnerId" <> u.id)::int AS losses
    FROM "User" u
    JOIN "Match" m ON (m."whitePlayerId" = u.id OR m."blackPlayerId" = u.id)
    WHERE u.id = ANY(${userIds})
      AND m.status IN ('COMPLETED', 'ABANDONED', 'DISPUTED')
      AND m."isBye" = false
      AND m.result IS NOT NULL
      AND m.result <> 'NO_RESULT'
    GROUP BY u.id`;
  for (const r of rows) {
    out.set(r.userId, {
      games: r.games,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      winRate: r.games ? Math.round((r.wins / r.games) * 1000) / 10 : 0,
    });
  }
  return out;
}

export async function statsForOne(userId: string): Promise<PlayerStats> {
  return (await statsFor([userId])).get(userId) ?? empty();
}

/**
 * Leaderboard order (deterministic): rating desc, then games played desc, then username asc.
 * Only active players with a public profile appear.
 */
export async function leaderboard(page: number, pageSize: number) {
  const where = { role: 'PLAYER' as const, accountStatus: 'ACTIVE' as const, profilePublic: true };
  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: { id: true, username: true, displayName: true, avatar: true, profile: { select: { rating: true, peakRating: true } } },
      orderBy: [{ profile: { rating: 'desc' } }, { username: 'asc' }],
    }),
  ]);
  const stats = await statsFor(users.map((u) => u.id));
  const ranked = users
    .map((u) => ({ ...u, rating: u.profile?.rating ?? 0, stats: stats.get(u.id)! }))
    .sort((a, b) => b.rating - a.rating || b.stats.games - a.stats.games || a.username.localeCompare(b.username))
    .map((u, i) => ({
      rank: i + 1,
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      rating: u.rating,
      peakRating: u.profile?.peakRating ?? u.rating,
      ...u.stats,
    }));
  return { items: ranked.slice((page - 1) * pageSize, page * pageSize), total, all: ranked };
}

export async function rankOf(userId: string): Promise<number | null> {
  const { all } = await leaderboard(1, 1);
  return all.find((r) => r.id === userId)?.rank ?? null;
}
