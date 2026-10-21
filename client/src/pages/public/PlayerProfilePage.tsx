import { useState } from 'react';
import { useParams } from 'react-router';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner, StatCard, cx } from '../../components/ui';
import { useAuth } from '../../features/auth/AuthContext';
import { MatchRow } from '../../features/matches/MatchRow';
import { useAsync } from '../../hooks/useAsync';
import { get, getPaged } from '../../services/api/client';
import type { MatchListItem, PlayerStats, PublicUser } from '../../types/api';
import { formatDateTime } from '../../utils/format';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';

export function PlayerProfilePage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const profile = useAsync(() => get<PublicUser & { stats: PlayerStats; rank: number | null }>(`/players/${id}`), [id]);
  const games = useAsync(() => getPaged<MatchListItem>(`/players/${id}/matches`, { page, pageSize: 10 }), [id, page]);
  useLiveRefresh(() => Promise.all([profile.reload(), games.reload()]));

  if (profile.loading && !profile.data) return <Spinner />;
  if (profile.error || !profile.data) return <ErrorState message={profile.error ?? 'Not found'} />;
  const p = profile.data;

  return (
    <div className={cx('space-y-6', !user && 'mx-auto max-w-4xl px-4 py-8')}>
      <PageHeader title={p.displayName} description={`@${p.username} · member since ${formatDateTime(p.createdAt)}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Rating" value={p.profile?.rating ?? '—'} hint={`Peak ${p.profile?.peakRating ?? '—'}`} />
        <StatCard label="Rank" value={p.rank ? `#${p.rank}` : '—'} />
        <StatCard label="Games" value={p.stats.games} />
        <StatCard label="W / D / L" value={`${p.stats.wins}/${p.stats.draws}/${p.stats.losses}`} />
        <StatCard label="Win rate" value={`${p.stats.winRate}%`} />
      </div>
      <Card title="Recent public games">
        {games.loading && !games.data ? (
          <Spinner />
        ) : (games.data?.data ?? []).length === 0 ? (
          <EmptyState title="No public games yet" />
        ) : (
          <>
            <div className="-mx-3">
              {games.data!.data.map((m) => (
                <MatchRow key={m.id} m={m} viewerId={id} />
              ))}
            </div>
            <Pagination page={page} totalPages={games.data!.meta.totalPages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
