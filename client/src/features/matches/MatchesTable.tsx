import { Eye, History } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PlayerPicker } from '../../components/PlayerPicker';
import { DataTable } from '../../components/tables/DataTable';
import { Badge, Select } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { getPaged } from '../../services/api/client';
import type { MatchListItem, PublicUser } from '../../types/api';
import { formatDateTime, formatTimeControl, humanize, resultToken, statusTone } from '../../utils/format';

const STATUSES = ['IN_PROGRESS', 'READY', 'WAITING', 'CREATED', 'COMPLETED', 'ABANDONED', 'DISPUTED', 'CANCELLED'];
const FINISHED = ['COMPLETED', 'ABANDONED', 'DISPUTED'];

/** Filterable match list for admins (/admin/matches) and coordinators (/coordinator/matches). */
export function MatchesTable({ endpoint, showPlayerFilter = false, defaultStatus = '' }: { endpoint: string; showPlayerFilter?: boolean; defaultStatus?: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(defaultStatus);
  const [sort, setSort] = useState('createdAt');
  const [player, setPlayer] = useState<PublicUser | null>(null);
  const list = useAsync(
    () => getPaged<MatchListItem>(endpoint, { page, pageSize: 20, status: status || undefined, sort, playerId: player?.id }),
    [page, status, sort, endpoint, player?.id],
  );
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} name="status">
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </Select>
        <Select label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} name="sort">
          <option value="createdAt">Created</option>
          <option value="completedAt">Completed</option>
          <option value="scheduledAt">Scheduled</option>
        </Select>
        {showPlayerFilter && (
          <PlayerPicker
            label="Player"
            value={player}
            onChange={(u) => {
              setPlayer(u);
              setPage(1);
            }}
          />
        )}
      </div>
      <DataTable
        rows={list.data?.data}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        rowKey={(m) => m.id}
        empty="No games found"
        page={page}
        totalPages={list.data?.meta.totalPages}
        onPage={setPage}
        columns={[
          {
            key: 'players',
            header: 'Players',
            render: (m) => (
              <span className="font-medium text-stone-900">
                {m.white?.displayName ?? '—'} <span className="text-stone-400">vs</span> {m.black?.displayName ?? '—'}
              </span>
            ),
          },
          { key: 'status', header: 'Status', render: (m) => <Badge tone={statusTone(m.status)}>{humanize(m.status)}</Badge> },
          { key: 'result', header: 'Result', render: (m) => <span className="font-mono">{resultToken(m.result)}</span> },
          { key: 'tc', header: 'Time', render: (m) => `${formatTimeControl(m.initialTimeMs, m.incrementMs)}${m.rated ? '' : ' · casual'}` },
          { key: 'event', header: 'Event', render: (m) => (m.tournament ? `${m.tournament.name}${m.round ? ` R${m.round.roundNumber}` : ''}` : humanize(m.source)) },
          { key: 'when', header: 'When', render: (m) => <span className="text-stone-600">{formatDateTime(m.completedAt ?? m.scheduledAt ?? m.createdAt)}</span> },
          {
            key: 'open',
            header: '',
            className: 'text-right',
            render: (m) =>
              FINISHED.includes(m.status) ? (
                <Link to={`/games/${m.id}/replay`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-stone-700 ring-1 ring-stone-300 hover:bg-stone-100">
                  <History className="size-3.5" /> Replay
                </Link>
              ) : m.status === 'CANCELLED' ? null : (
                <Link to={`/games/${m.id}`} className="inline-flex items-center gap-1 rounded-lg bg-green-800 px-2 py-1 text-sm font-medium text-white hover:bg-green-900">
                  <Eye className="size-3.5" /> Watch
                </Link>
              ),
          },
        ]}
      />
    </>
  );
}
