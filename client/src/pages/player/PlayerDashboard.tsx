import { Swords, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard } from '../../components/ui';
import { useAuth } from '../../features/auth/AuthContext';
import { MatchRow } from '../../features/matches/MatchRow';
import { useAsync } from '../../hooks/useAsync';
import { useSocketEvent } from '../../hooks/useSocket';
import { get } from '../../services/api/client';
import type { Invitation, MatchListItem, Me, PlayerStats } from '../../types/api';
import { humanize } from '../../utils/format';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';

interface Dashboard {
  profile: Me;
  stats: PlayerStats;
  rank: number | null;
  active: MatchListItem[];
  upcoming: MatchListItem[];
  recent: MatchListItem[];
  invitations: Invitation[];
  tournaments: { registrationStatus: string; tournament: { id: string; name: string; status: string; format: string; startsAt: string | null } }[];
  ratingHistory: { ratingAfter: number; ratingChange: number; createdAt: string; matchId: string }[];
}

/** Small inline SVG sparkline of rating over time (no chart library needed). */
function RatingSparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="text-sm text-stone-500">Play rated games to see your rating trend.</p>;
  const w = 320;
  const h = 72;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 6 - ((p - min) / span) * (h - 12)).toFixed(1)}`).join(' ');
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" role="img" aria-label={`Rating from ${points[0]} to ${points[points.length - 1]}`}>
        <path d={d} fill="none" stroke="#f97316" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="flex justify-between text-xs text-stone-500 tabular-nums">
        <span>low {min}</span>
        <span>high {max}</span>
      </figcaption>
    </figure>
  );
}

export function PlayerDashboard() {
  const { user } = useAuth();
  const dash = useAsync(() => get<Dashboard>('/players/me/dashboard'), []);
  useLiveRefresh(dash.reload);
  useSocketEvent('notification:new', () => void dash.reload());

  if (dash.loading && !dash.data) return <Spinner />;
  if (dash.error || !dash.data) return <ErrorState message={dash.error ?? 'Failed to load'} onRetry={dash.reload} />;
  const d = dash.data;
  const incoming = d.invitations.filter((i) => i.inviteeId === user?.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${d.profile.displayName}`}
        description={`@${d.profile.username}`}
        actions={
          <Link to="/play/lobby" className="inline-flex items-center gap-2 rounded-lg bg-green-800 px-4 py-2 text-sm font-medium text-white hover:bg-green-900">
            <Swords className="size-4" /> Play now
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Rating" value={d.profile.profile?.rating ?? '—'} hint={`Peak ${d.profile.profile?.peakRating ?? '—'}`} />
        <StatCard label="Rank" value={d.rank ? `#${d.rank}` : '—'} hint="Global leaderboard" />
        <StatCard label="Games" value={d.stats.games} />
        <StatCard label="Wins" value={d.stats.wins} />
        <StatCard label="Draws / Losses" value={`${d.stats.draws} / ${d.stats.losses}`} />
        <StatCard label="Win rate" value={`${d.stats.winRate}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {(d.active.length > 0 || d.upcoming.length > 0) && (
            <Card title="Active & upcoming games">
              <div className="-mx-3">
                {[...d.active, ...d.upcoming].map((m) => (
                  <MatchRow key={m.id} m={m} viewerId={user?.id} />
                ))}
              </div>
            </Card>
          )}
          {incoming.length > 0 && (
            <Card title="Pending invitations" action={<Link to="/play/lobby" className="text-xs text-green-800 hover:underline">Respond</Link>}>
              <ul className="space-y-1 text-sm">
                {incoming.map((i) => (
                  <li key={i.id}>
                    <strong>{i.inviter.displayName}</strong> challenged you
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Recent games" action={<Link to="/play/history" className="text-xs text-green-800 hover:underline">All games</Link>}>
            {d.recent.length === 0 ? (
              <EmptyState title="No finished games yet" />
            ) : (
              <div className="-mx-3">
                {d.recent.map((m) => (
                  <MatchRow key={m.id} m={m} viewerId={user?.id} />
                ))}
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Rating trend">
            <RatingSparkline points={[1200, ...d.ratingHistory.map((r) => r.ratingAfter)].slice(d.ratingHistory.length ? 0 : 1)} />
          </Card>
          <Card title="Tournaments">
            {d.tournaments.length === 0 ? (
              <EmptyState icon={<Trophy className="size-6" />} title="You haven't joined a tournament yet" />
            ) : (
              <ul className="divide-y divide-stone-100">
                {d.tournaments.map((t) => (
                  <li key={t.tournament.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-stone-900">{t.tournament.name}</span>
                    <span className="flex gap-2">
                      <Badge>{humanize(t.tournament.status)}</Badge>
                      {t.registrationStatus === 'ELIMINATED' && <Badge tone="red">Eliminated</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
