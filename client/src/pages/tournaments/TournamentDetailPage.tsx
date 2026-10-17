import { Megaphone, Shuffle, UserMinus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { PlayerPicker } from '../../components/PlayerPicker';
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Spinner, StatCard, cx } from '../../components/ui';
import { ConfirmDialog, Dialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../features/auth/AuthContext';
import { MatchRow } from '../../features/matches/MatchRow';
import {
  tournamentTone,
  type Announcement,
  type Participant,
  type Round,
  type StandingRow,
  type TournamentDetail,
  type TournamentStatus,
} from '../../features/tournaments/types';
import { useAsync } from '../../hooks/useAsync';
import { del, errorMessage, get, getPaged, post, put } from '../../services/api/client';
import type { Me, PublicUser } from '../../types/api';
import { formatDateTime, formatTimeControl, humanize } from '../../utils/format';

const NEXT: Record<TournamentStatus, { to: TournamentStatus; label: string; adminOnly?: boolean; danger?: boolean }[]> = {
  DRAFT: [{ to: 'PUBLISHED', label: 'Publish', adminOnly: true }],
  PUBLISHED: [
    { to: 'REGISTRATION_OPEN', label: 'Open registration' },
    { to: 'DRAFT', label: 'Unpublish', adminOnly: true },
  ],
  REGISTRATION_OPEN: [{ to: 'REGISTRATION_CLOSED', label: 'Close registration' }],
  REGISTRATION_CLOSED: [
    { to: 'IN_PROGRESS', label: 'Start tournament' },
    { to: 'REGISTRATION_OPEN', label: 'Reopen registration' },
  ],
  IN_PROGRESS: [],
  COMPLETED: [],
  CANCELLED: [],
};

type Tab = 'standings' | 'rounds' | 'participants' | 'announcements';

export function TournamentDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('standings');
  const t = useAsync(() => get<TournamentDetail>(`/tournaments/${id}`), [id]);
  const participants = useAsync(() => get<Participant[]>(`/tournaments/${id}/participants`), [id]);
  const standings = useAsync(() => get<StandingRow[]>(`/tournaments/${id}/standings`), [id]);
  const rounds = useAsync(() => get<Round[]>(`/tournaments/${id}/rounds`), [id]);
  const announcements = useAsync(() => get<Announcement[]>(`/tournaments/${id}/announcements`), [id]);

  const [addPlayer, setAddPlayer] = useState<PublicUser | null>(null);
  const [removing, setRemoving] = useState<Participant | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announce, setAnnounce] = useState({ title: '', body: '' });
  const [coordOpen, setCoordOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reloadAll = () => Promise.all([t.reload(), participants.reload(), standings.reload(), rounds.reload(), announcements.reload()]);

  async function act(key: string, fn: () => Promise<unknown>, msg: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(msg);
      await reloadAll();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (t.loading && !t.data) return <Spinner />;
  if (t.error || !t.data) return <ErrorState message={t.error ?? 'Not found'} onRetry={t.reload} />;
  const d = t.data;
  const isAdmin = user?.role === 'ADMIN';
  const lastRound = rounds.data?.[rounds.data.length - 1];
  const canGenerate = d.canManage && d.status === 'IN_PROGRESS' && (!lastRound || lastRound.status === 'COMPLETED') && (rounds.data?.length ?? 0) < d.plannedRounds;
  const canEditRoster = d.canManage && ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(d.status);

  return (
    <div className={cx('space-y-6', !user && 'mx-auto max-w-6xl px-4 py-8')}>
      <PageHeader
        title={d.name}
        description={`${humanize(d.format)} · ${formatTimeControl(d.initialTimeMs, d.incrementMs)} · ${d.rated ? 'Rated' : 'Casual'}`}
        actions={
          <>
            <Badge tone={tournamentTone(d.status)}>{humanize(d.status)}</Badge>
            {user?.role === 'PLAYER' && d.status === 'REGISTRATION_OPEN' && d.myRegistration !== 'REGISTERED' && (
              <Button size="sm" loading={busy === 'reg'} onClick={() => void act('reg', () => post(`/tournaments/${id}/register`), 'Registered')}>
                Register
              </Button>
            )}
            {user?.role === 'PLAYER' && d.status === 'REGISTRATION_OPEN' && d.myRegistration === 'REGISTERED' && (
              <Button size="sm" variant="secondary" loading={busy === 'unreg'} onClick={() => void act('unreg', () => del(`/tournaments/${id}/register`), 'Withdrawn')}>
                Withdraw
              </Button>
            )}
          </>
        }
      />

      {d.description && <p className="max-w-3xl text-sm whitespace-pre-line text-stone-700">{d.description}</p>}
      {d.status === 'CANCELLED' && d.cancelReason && <ErrorState message={`Cancelled: ${d.cancelReason}`} />}
      {d.winner && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          🏆 Winner: <strong>{d.winner.displayName}</strong>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Players" value={`${d._count.participants}/${d.maxParticipants}`} hint={`min ${d.minParticipants}`} />
        <StatCard label="Rounds" value={`${rounds.data?.length ?? 0}/${d.plannedRounds || '—'}`} />
        <StatCard label="Scoring" value={<span className="text-base">{d.pointsWin} / {d.pointsDraw} / {d.pointsLoss}</span>} hint={`win / draw / loss · bye ${d.pointsBye}`} />
        <StatCard label="Registration" value={<span className="text-sm">{formatDateTime(d.registrationOpensAt)}</span>} hint={`closes ${formatDateTime(d.registrationClosesAt)}`} />
        <StatCard label="Starts" value={<span className="text-sm">{formatDateTime(d.startsAt)}</span>} hint={`Coordinators: ${d.coordinators.map((c) => c.coordinator.displayName).join(', ') || 'none'}`} />
      </div>

      {d.canManage && d.status !== 'COMPLETED' && d.status !== 'CANCELLED' && (
        <Card title="Manage">
          <div className="flex flex-wrap gap-2">
            {NEXT[d.status]
              .filter((n) => !n.adminOnly || isAdmin)
              .map((n) => (
                <Button key={n.to} variant="secondary" loading={busy === n.to} onClick={() => void act(n.to, () => post(`/tournaments/${id}/status`, { status: n.to }), `${n.label}: done`)}>
                  {n.label}
                </Button>
              ))}
            {canGenerate && (
              <Button icon={<Shuffle className="size-4" />} loading={busy === 'round'} onClick={() => void act('round', () => post(`/tournaments/${id}/rounds`), 'Pairings published')}>
                Generate round {(rounds.data?.length ?? 0) + 1}
              </Button>
            )}
            <Button variant="secondary" icon={<Megaphone className="size-4" />} onClick={() => setAnnounceOpen(true)}>
              Announcement
            </Button>
            {isAdmin && (
              <>
                <Button variant="ghost" onClick={() => setCoordOpen(true)}>
                  Coordinators
                </Button>
                <Button variant="danger" onClick={() => setCancelling(true)}>
                  Cancel tournament
                </Button>
              </>
            )}
          </div>
          {d.status === 'IN_PROGRESS' && lastRound && lastRound.status !== 'COMPLETED' && (
            <p className="mt-3 text-sm text-stone-600">Round {lastRound.roundNumber} is in progress; the next round can be generated once every game has a result.</p>
          )}
          {canEditRoster && (
            <div className="mt-4 flex max-w-lg items-end gap-2">
              <div className="flex-1">
                <PlayerPicker label="Register a player" value={addPlayer} onChange={setAddPlayer} excludeIds={(participants.data ?? []).map((p) => p.player.id)} />
              </div>
              <Button
                disabled={!addPlayer}
                loading={busy === 'add'}
                onClick={() => addPlayer && void act('add', () => post(`/tournaments/${id}/participants`, { playerId: addPlayer.id }), `${addPlayer.displayName} registered`).then(() => setAddPlayer(null))}
              >
                Add
              </Button>
            </div>
          )}
        </Card>
      )}

      <div>
        <div role="tablist" className="mb-4 flex gap-1 border-b border-stone-200">
          {(['standings', 'rounds', 'participants', 'announcements'] as Tab[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize', tab === k ? 'border-green-800 text-green-900' : 'border-transparent text-stone-600 hover:text-stone-900')}
            >
              {k}
            </button>
          ))}
        </div>

        {tab === 'standings' && (
          <Card>
            {(standings.data ?? []).length === 0 ? (
              <EmptyState title="No standings yet" />
            ) : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-2">#</th>
                      <th className="px-4 py-2">Player</th>
                      <th className="px-4 py-2 text-right">Pts</th>
                      <th className="px-4 py-2 text-right" title="Sonneborn–Berger">SB</th>
                      <th className="px-4 py-2 text-right">W/D/L</th>
                      <th className="px-4 py-2 text-right">Byes</th>
                      <th className="px-4 py-2 text-right">Seed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.data!.map((r) => (
                      <tr key={r.id} className={cx('border-b border-stone-100 last:border-0', r.id === user?.id && 'bg-green-50', r.eliminated && 'text-stone-400')}>
                        <td className="px-4 py-2 font-semibold tabular-nums">{r.rank}</td>
                        <td className="px-4 py-2">
                          <Link to={`/players/${r.id}`} className="hover:underline">
                            {r.displayName}
                          </Link>
                          {r.eliminated && <span className="ml-2 text-xs">eliminated</span>}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.points}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.sonnebornBerger}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.wins}/{r.draws}/{r.losses}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.byes}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.seed ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-stone-500">Tie-breaks: points, Sonneborn–Berger, wins, head-to-head, seed.</p>
          </Card>
        )}

        {tab === 'rounds' && (
          <div className="space-y-4">
            {(rounds.data ?? []).length === 0 ? (
              <Card>
                <EmptyState title="No rounds yet" />
              </Card>
            ) : (
              rounds.data!.map((r) => (
                <Card key={r.id} title={`Round ${r.roundNumber}`} action={<Badge tone={r.status === 'COMPLETED' ? 'gray' : 'blue'}>{humanize(r.status)}</Badge>}>
                  <div className="-mx-3">
                    {r.matches.map((m) => (
                      <MatchRow key={m.id} m={m} viewerId={user?.id} href={m.isBye ? `/tournaments/${id}` : undefined} />
                    ))}
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {tab === 'participants' && (
          <Card>
            {(participants.data ?? []).length === 0 ? (
              <EmptyState title="No participants yet" />
            ) : (
              <ul className="divide-y divide-stone-100">
                {participants.data!.map((p) => (
                  <li key={p.player.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      {p.seed && <span className="mr-2 text-xs text-stone-500">#{p.seed}</span>}
                      <Link to={`/players/${p.player.id}`} className="font-medium hover:underline">
                        {p.player.displayName}
                      </Link>
                      <span className="ml-1 text-stone-500">({p.player.profile?.rating ?? p.ratingAtRegistration})</span>
                      {p.registrationStatus === 'ELIMINATED' && <Badge tone="red">eliminated</Badge>}
                    </span>
                    {canEditRoster && (
                      <button className="text-stone-400 hover:text-red-700" onClick={() => setRemoving(p)} aria-label={`Remove ${p.player.displayName}`}>
                        <UserMinus className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {tab === 'announcements' && (
          <Card>
            {(announcements.data ?? []).length === 0 ? (
              <EmptyState title="No announcements" />
            ) : (
              <ul className="space-y-4">
                {announcements.data!.map((a) => (
                  <li key={a.id}>
                    <p className="font-medium text-stone-900">{a.title}</p>
                    <p className="text-sm whitespace-pre-line text-stone-700">{a.body}</p>
                    <p className="text-xs text-stone-500">
                      {a.author.displayName} · {formatDateTime(a.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove participant?"
        message={removing ? `${removing.player.displayName} will be removed from this tournament.` : ''}
        tone="danger"
        requireReason
        onClose={() => setRemoving(null)}
        onConfirm={(reason) => (removing ? act('rm', () => del(`/tournaments/${id}/participants/${removing.player.id}`, { reason }), 'Participant removed') : undefined)}
      />
      <ConfirmDialog
        open={cancelling}
        title="Cancel tournament?"
        message="Unstarted matches are cancelled and participants are notified. This cannot be undone."
        tone="danger"
        requireReason
        confirmLabel="Cancel tournament"
        onClose={() => setCancelling(false)}
        onConfirm={(reason) => act('cancel', () => post(`/tournaments/${id}/status`, { status: 'CANCELLED', reason }), 'Tournament cancelled')}
      />
      <Dialog open={announceOpen} title="New announcement" onClose={() => setAnnounceOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act('ann', () => post(`/tournaments/${id}/announcements`, announce), 'Announcement posted').then(() => {
              setAnnounce({ title: '', body: '' });
              setAnnounceOpen(false);
            });
          }}
        >
          <Input label="Title" required minLength={3} value={announce.title} onChange={(e) => setAnnounce({ ...announce, title: e.target.value })} name="title" />
          <div>
            <label htmlFor="ann-body" className="mb-1 block text-sm font-medium text-stone-700">
              Message
            </label>
            <textarea id="ann-body" required rows={4} value={announce.body} onChange={(e) => setAnnounce({ ...announce, body: e.target.value })} className="block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAnnounceOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy === 'ann'}>
              Post to participants
            </Button>
          </div>
        </form>
      </Dialog>
      {isAdmin && coordOpen && (
        <CoordinatorsDialog
          current={d.coordinators.map((c) => c.coordinator.id)}
          onClose={() => setCoordOpen(false)}
          onSave={(ids) => act('coord', () => put(`/tournaments/${id}/coordinators`, { coordinatorIds: ids }), 'Coordinators updated').then(() => setCoordOpen(false))}
        />
      )}
    </div>
  );
}

function CoordinatorsDialog({ current, onClose, onSave }: { current: string[]; onClose: () => void; onSave: (ids: string[]) => Promise<void> }) {
  const all = useAsync(() => getPaged<Me>('/admin/users', { role: 'COORDINATOR', status: 'ACTIVE', pageSize: 100 }), []);
  const [selected, setSelected] = useState(current);
  return (
    <Dialog open title="Assigned coordinators" onClose={onClose}>
      {all.loading ? (
        <Spinner />
      ) : (all.data?.data ?? []).length === 0 ? (
        <p>No coordinator accounts exist yet.</p>
      ) : (
        <div className="space-y-2">
          {all.data!.data.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-green-800" checked={selected.includes(c.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))} />
              {c.displayName} <span className="text-stone-500">@{c.username}</span>
            </label>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void onSave(selected)}>Save</Button>
      </div>
    </Dialog>
  );
}
