import { Plus, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Select, Spinner, cx } from '../../components/ui';
import { useAuth } from '../../features/auth/AuthContext';
import { tournamentTone, type TournamentSummary } from '../../features/tournaments/types';
import { useAsync } from '../../hooks/useAsync';
import { getPaged } from '../../services/api/client';
import { formatDateTime, formatTimeControl, humanize } from '../../utils/format';

export function TournamentsPage({ scope = 'all', title = 'Tournaments', base = '/tournaments' }: { scope?: 'all' | 'assigned'; title?: string; base?: string }) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const list = useAsync(() => getPaged<TournamentSummary>('/tournaments', { page, pageSize: 12, status: status || undefined, scope }), [page, status, scope]);

  return (
    <div className={cx(!user && 'mx-auto max-w-6xl px-4 py-8')}>
      <PageHeader
        title={title}
        description={scope === 'assigned' ? 'Tournaments you are assigned to coordinate.' : 'Round-robin and knockout events.'}
        actions={
          user?.role === 'ADMIN' && (
            <Link to="/admin/tournaments/new" className="inline-flex items-center gap-2 rounded-lg bg-green-800 px-4 py-2 text-sm font-medium text-white hover:bg-green-900">
              <Plus className="size-4" /> New tournament
            </Link>
          )
        }
      />
      <div className="mb-4 max-w-xs">
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} name="status">
          <option value="">All</option>
          {['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </Select>
      </div>
      {list.loading && !list.data ? (
        <Spinner />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (list.data?.data ?? []).length === 0 ? (
        <Card>
          <EmptyState icon={<Trophy className="size-6" />} title="No tournaments found" />
        </Card>
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.data!.data.map((t) => (
              <li key={t.id}>
                <Link to={`${base}/${t.id}`} className="spooky-glow block h-full rounded-xl border border-stone-200 bg-white p-4 shadow-xs transition hover:border-green-700">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-stone-900">{t.name}</h2>
                    <Badge tone={tournamentTone(t.status)}>{humanize(t.status)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-stone-600">
                    {humanize(t.format)} · {formatTimeControl(t.initialTimeMs, t.incrementMs)} · {t.rated ? 'Rated' : 'Casual'}
                  </p>
                  <p className="mt-3 text-xs text-stone-500">
                    {t._count.participants}/{t.maxParticipants} players · starts {formatDateTime(t.startsAt)}
                  </p>
                  {t.winner && <p className="mt-1 text-xs font-medium text-green-800">Winner: {t.winner.displayName}</p>}
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={list.data!.meta.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
