import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner, cx } from '../../components/ui';
import { useAuth } from '../../features/auth/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { getPaged } from '../../services/api/client';
import type { LeaderboardRow } from '../../types/api';

export function LeaderboardPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const list = useAsync(() => getPaged<LeaderboardRow>('/leaderboard', { page, pageSize: 25 }), [page]);

  return (
    <div className={cx(!user && 'mx-auto max-w-4xl px-4 py-8')}>
      <PageHeader title="Leaderboard" description="Ranked by rating, then games played, then username." />
      <Card>
        {list.loading && !list.data ? (
          <Spinner />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (list.data?.data ?? []).length === 0 ? (
          <EmptyState icon={<Trophy className="size-6" />} title="No ranked players yet" />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Player</th>
                    <th className="px-4 py-2 text-right font-medium">Rating</th>
                    <th className="px-4 py-2 text-right font-medium">Games</th>
                    <th className="px-4 py-2 text-right font-medium">W / D / L</th>
                    <th className="px-4 py-2 text-right font-medium">Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data!.data.map((r) => (
                    <tr key={r.id} className={cx('border-b border-stone-100 last:border-0', r.id === user?.id && 'bg-green-50')}>
                      <td className="px-4 py-2.5 font-semibold text-stone-500 tabular-nums">{r.rank}</td>
                      <td className="px-4 py-2.5">
                        <Link to={`/players/${r.id}`} className="font-medium text-stone-900 hover:underline">
                          {r.displayName}
                        </Link>
                        <span className="ml-1 text-stone-500">@{r.username}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{r.rating}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.games}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-600">
                        {r.wins} / {r.draws} / {r.losses}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.winRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={list.data!.meta.totalPages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
