import { Link } from 'react-router';
import { Card, ErrorState, PageHeader, Spinner, StatCard } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { get } from '../../services/api/client';
import { humanize, relativeTime } from '../../utils/format';

interface Overview {
  users: { players: number; coordinators: number; admins: number; suspended: number; disabled: number };
  matches: { active: number; scheduled: number; completed: number; completedThisWeek: number; perDay: { date: string; games: number }[] };
  tournaments: { upcoming: number; byStatus: Record<string, number> };
  openDisputes: number;
  recentActivity: { id: string; action: string; resourceType: string; resourceId: string | null; createdAt: string; actor: { username: string } | null }[];
}

function GamesPerDay({ data }: { data: { date: string; games: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.games));
  return (
    <figure>
      <div className="flex h-32 items-end gap-2" role="img" aria-label={`Games finished per day: ${data.map((d) => `${d.date} ${d.games}`).join(', ')}`}>
        {data.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs text-stone-600 tabular-nums">{d.games}</span>
            <div className="w-full rounded-t bg-green-700" style={{ height: `${Math.max(2, (d.games / max) * 96)}px` }} />
          </div>
        ))}
      </div>
      <figcaption className="mt-1 flex gap-2 text-[11px] text-stone-500">
        {data.map((d) => (
          <span key={d.date} className="flex-1 text-center">
            {new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function AdminOverview() {
  const o = useAsync(() => get<Overview>('/admin/overview'), []);
  if (o.loading && !o.data) return <Spinner />;
  if (o.error || !o.data) return <ErrorState message={o.error ?? 'Failed'} onRetry={o.reload} />;
  const d = o.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" description="Live figures from the database." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <StatCard label="Players" value={d.users.players} />
        <StatCard label="Coordinators" value={d.users.coordinators} />
        <StatCard label="Active games" value={d.matches.active} hint={`${d.matches.scheduled} scheduled`} />
        <StatCard label="Completed games" value={d.matches.completed} hint={`${d.matches.completedThisWeek} this week`} />
        <StatCard label="Upcoming tournaments" value={d.tournaments.upcoming} />
        <StatCard label="Suspended / disabled" value={`${d.users.suspended} / ${d.users.disabled}`} />
        <StatCard label="Open disputes" value={d.openDisputes} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Games finished (last 7 days)">
          <GamesPerDay data={d.matches.perDay} />
        </Card>
        <Card title="Tournaments by status">
          {Object.keys(d.tournaments.byStatus).length === 0 ? (
            <p className="text-sm text-stone-500">No tournaments yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {Object.entries(d.tournaments.byStatus).map(([s, n]) => (
                <li key={s} className="flex justify-between">
                  <span>{humanize(s)}</span>
                  <span className="font-medium tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Recent activity" action={<Link to="/admin/audit" className="text-xs text-green-800 hover:underline">Full audit log</Link>}>
        <ul className="divide-y divide-stone-100 text-sm">
          {d.recentActivity.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 py-2">
              <span>
                <span className="font-mono text-xs text-stone-700">{a.action}</span>
                <span className="ml-2 text-stone-500">by {a.actor?.username ?? 'system'}</span>
              </span>
              <span className="shrink-0 text-xs text-stone-500">{relativeTime(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
