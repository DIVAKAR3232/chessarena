import { useState } from 'react';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner } from '../../components/ui';
import { useAuth } from '../../features/auth/AuthContext';
import { MatchRow } from '../../features/matches/MatchRow';
import { useAsync } from '../../hooks/useAsync';
import { getPaged } from '../../services/api/client';
import type { MatchListItem } from '../../types/api';

export function HistoryPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const list = useAsync(() => getPaged<MatchListItem>(`/players/${user!.id}/matches`, { page, pageSize: 20 }), [page, user?.id]);

  return (
    <div>
      <PageHeader title="Game history" description="Your finished games. Open any game to replay it move by move." />
      <Card>
        {list.loading && !list.data ? (
          <Spinner />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (list.data?.data ?? []).length === 0 ? (
          <EmptyState title="No finished games yet" />
        ) : (
          <>
            <div className="-mx-3">
              {list.data!.data.map((m) => (
                <MatchRow key={m.id} m={m} viewerId={user?.id} />
              ))}
            </div>
            <Pagination page={page} totalPages={list.data!.meta.totalPages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
