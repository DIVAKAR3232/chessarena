import { Link } from 'react-router';
import { Badge, cx } from '../../components/ui';
import type { MatchListItem } from '../../types/api';
import { formatDateTime, formatTimeControl, humanize, outcomeFor, resultToken, statusTone } from '../../utils/format';

/** Compact match line used across dashboards and history lists. */
export function MatchRow({ m, viewerId, href }: { m: MatchListItem; viewerId?: string; href?: string }) {
  const outcome = viewerId ? outcomeFor(m, viewerId) : 'none';
  const finished = ['COMPLETED', 'ABANDONED', 'DISPUTED'].includes(m.status);
  return (
    <Link
      to={href ?? (finished ? `/games/${m.id}/replay` : `/games/${m.id}`)}
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-stone-50"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-stone-900">
          <span className="mr-1 inline-block size-2.5 rounded-full bg-white ring-1 ring-stone-400 align-middle" />
          {m.white?.displayName ?? 'Open seat'}
          <span className="mx-1.5 text-stone-400">vs</span>
          <span className="mr-1 inline-block size-2.5 rounded-full bg-stone-900 align-middle" />
          {m.black?.displayName ?? (m.status === 'COMPLETED' ? 'Bye' : 'Open seat')}
        </p>
        <p className="text-xs text-stone-500">
          {formatTimeControl(m.initialTimeMs, m.incrementMs)} · {m.rated ? 'Rated' : 'Casual'}
          {m.tournament ? ` · ${m.tournament.name}${m.round ? ` R${m.round.roundNumber}` : ''}` : ''} ·{' '}
          {formatDateTime(m.completedAt ?? m.scheduledAt ?? m.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {finished && m.result && <span className="font-mono text-sm text-stone-700">{resultToken(m.result)}</span>}
        {outcome !== 'none' ? (
          <span className={cx('w-12 text-center text-xs font-semibold uppercase', outcome === 'win' ? 'text-green-700' : outcome === 'loss' ? 'text-red-700' : 'text-stone-500')}>
            {outcome}
          </span>
        ) : (
          <Badge tone={statusTone(m.status)}>{humanize(m.status)}</Badge>
        )}
      </div>
    </Link>
  );
}
