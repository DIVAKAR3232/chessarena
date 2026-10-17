import { CalendarPlus, Flag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, Spinner, StatCard } from '../../components/ui';
import { Dialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { MatchRow } from '../../features/matches/MatchRow';
import { MatchesTable } from '../../features/matches/MatchesTable';
import { tournamentTone, type Participant, type TournamentSummary } from '../../features/tournaments/types';
import { useAsync } from '../../hooks/useAsync';
import { errorMessage, get, getPaged, post } from '../../services/api/client';
import type { MatchListItem } from '../../types/api';
import { formatTimeControl, humanize, relativeTime } from '../../utils/format';

interface Overview {
  tournaments: (TournamentSummary & { _count: { participants: number; rounds: number } })[];
  ongoing: MatchListItem[];
  upcoming: MatchListItem[];
  completed: MatchListItem[];
  matchCounts: Record<string, number>;
  openDisputes: number;
  participants: number;
  recentActivity: { id: string; action: string; createdAt: string; actor: { username: string } | null }[];
}

export function CoordinatorDashboard() {
  const o = useAsync(() => get<Overview>('/coordinator/overview'), []);
  if (o.loading && !o.data) return <Spinner />;
  if (o.error || !o.data) return <ErrorState message={o.error ?? 'Failed'} onRetry={o.reload} />;
  const d = o.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Coordinator dashboard" description="Everything here is limited to the tournaments and matches assigned to you." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Assigned tournaments" value={d.tournaments.length} />
        <StatCard label="Registered players" value={d.participants} />
        <StatCard label="Ongoing" value={d.matchCounts.IN_PROGRESS ?? 0} />
        <StatCard label="Upcoming" value={(d.matchCounts.READY ?? 0) + (d.matchCounts.WAITING ?? 0)} />
        <StatCard label="Completed" value={(d.matchCounts.COMPLETED ?? 0) + (d.matchCounts.ABANDONED ?? 0)} />
        <StatCard label="Open disputes" value={d.openDisputes} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Assigned tournaments">
          {d.tournaments.length === 0 ? (
            <EmptyState title="No tournaments assigned yet">An administrator assigns tournaments to coordinators.</EmptyState>
          ) : (
            <ul className="divide-y divide-stone-100">
              {d.tournaments.map((t) => (
                <li key={t.id}>
                  <Link to={`/coordinator/tournaments/${t.id}`} className="flex items-center justify-between gap-2 py-2.5 hover:bg-stone-50">
                    <span>
                      <span className="font-medium text-stone-900">{t.name}</span>
                      <span className="block text-xs text-stone-500">
                        {humanize(t.format)} · {t._count.participants}/{t.maxParticipants} players · {t._count.rounds} rounds
                      </span>
                    </span>
                    <Badge tone={tournamentTone(t.status)}>{humanize(t.status)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Live games (read-only monitoring)">
          {d.ongoing.length === 0 ? <EmptyState title="No games in progress" /> : <div className="-mx-3">{d.ongoing.map((m) => <MatchRow key={m.id} m={m} />)}</div>}
        </Card>
        <Card title="Upcoming matches">
          {d.upcoming.length === 0 ? <EmptyState title="Nothing scheduled" /> : <div className="-mx-3">{d.upcoming.map((m) => <MatchRow key={m.id} m={m} />)}</div>}
        </Card>
        <Card title="Recently completed">
          {d.completed.length === 0 ? <EmptyState title="No completed matches yet" /> : <div className="-mx-3">{d.completed.map((m) => <MatchRow key={m.id} m={m} />)}</div>}
        </Card>
      </div>
      <Card title="Recent operational activity">
        {d.recentActivity.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {d.recentActivity.map((a) => (
              <li key={a.id} className="flex justify-between py-1.5">
                <span className="font-mono text-xs">{a.action}</span>
                <span className="text-xs text-stone-500">
                  {a.actor?.username ?? 'system'} · {relativeTime(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ScheduleMatchDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const tournaments = useAsync(() => getPaged<TournamentSummary>('/tournaments', { scope: 'assigned', pageSize: 100 }), [open]);
  const eligible = (tournaments.data?.data ?? []).filter((t) => t.status === 'REGISTRATION_CLOSED' || t.status === 'IN_PROGRESS');
  const [tournamentId, setTournamentId] = useState('');
  const [white, setWhite] = useState('');
  const [black, setBlack] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const participants = useAsync(() => (tournamentId ? get<Participant[]>(`/tournaments/${tournamentId}/participants`) : Promise.resolve([] as Participant[])), [tournamentId]);
  const tournament = eligible.find((t) => t.id === tournamentId);

  useEffect(() => {
    setWhite('');
    setBlack('');
  }, [tournamentId]);

  return (
    <Dialog open={open} title="Schedule a match" onClose={onClose}>
      {eligible.length === 0 ? (
        <p>Matches can be scheduled in your assigned tournaments once registration has closed.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!tournament) return;
            setBusy(true);
            try {
              await post('/coordinator/matches', {
                tournamentId,
                whitePlayerId: white,
                blackPlayerId: black,
                initialTimeMs: tournament.initialTimeMs,
                incrementMs: tournament.incrementMs,
                rated: tournament.rated,
                ...(when ? { scheduledAt: new Date(when).toISOString() } : {}),
              });
              toast.success('Match scheduled; both players were notified');
              onCreated();
              onClose();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Select label="Tournament" value={tournamentId} onChange={(e) => setTournamentId(e.target.value)} required name="tournament">
            <option value="">Select…</option>
            {eligible.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({formatTimeControl(t.initialTimeMs, t.incrementMs)})
              </option>
            ))}
          </Select>
          {(['White', 'Black'] as const).map((label) => (
            <Select
              key={label}
              label={label}
              required
              value={label === 'White' ? white : black}
              onChange={(e) => (label === 'White' ? setWhite(e.target.value) : setBlack(e.target.value))}
              name={label}
            >
              <option value="">Select a participant…</option>
              {(participants.data ?? [])
                .filter((p) => p.registrationStatus === 'REGISTERED' && p.player.id !== (label === 'White' ? black : white))
                .map((p) => (
                  <option key={p.player.id} value={p.player.id}>
                    {p.player.displayName} ({p.player.profile?.rating ?? '—'})
                  </option>
                ))}
            </Select>
          ))}
          <Input label="Scheduled time (optional)" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} name="when" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!white || !black}>
              Schedule
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function ReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState('MISCONDUCT');
  const [matchId, setMatchId] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} title="Report to administrators" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post('/coordinator/reports', { kind, details, ...(matchId.trim() ? { matchId: matchId.trim() } : {}) });
            toast.success('Report sent to administrators');
            setDetails('');
            setMatchId('');
            onClose();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value)} name="kind">
          <option value="CHEATING">Suspected cheating</option>
          <option value="MISCONDUCT">Misconduct</option>
          <option value="TECHNICAL">Technical problem</option>
        </Select>
        <Input label="Match ID (optional)" value={matchId} onChange={(e) => setMatchId(e.target.value)} name="matchId" />
        <div>
          <label htmlFor="report-details" className="mb-1 block text-sm font-medium text-stone-700">
            Details
          </label>
          <textarea id="report-details" required minLength={10} rows={4} value={details} onChange={(e) => setDetails(e.target.value)} className="block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Send report
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CoordinatorMatches() {
  const [scheduling, setScheduling] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <div>
      <PageHeader
        title="Matches"
        description="Matches you coordinate or that belong to your tournaments. Live games open read-only."
        actions={
          <>
            <Button variant="secondary" icon={<Flag className="size-4" />} onClick={() => setReporting(true)}>
              Report issue
            </Button>
            <Button icon={<CalendarPlus className="size-4" />} onClick={() => setScheduling(true)}>
              Schedule match
            </Button>
          </>
        }
      />
      <Card>
        <MatchesTable key={key} endpoint="/coordinator/matches" />
      </Card>
      <ScheduleMatchDialog open={scheduling} onClose={() => setScheduling(false)} onCreated={() => setKey((k) => k + 1)} />
      <ReportDialog open={reporting} onClose={() => setReporting(false)} />
    </div>
  );
}
