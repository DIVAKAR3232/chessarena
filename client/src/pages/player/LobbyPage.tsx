import { Clock3, Inbox, Loader2, Swords, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { PlayerPicker } from '../../components/PlayerPicker';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Spinner, cx } from '../../components/ui';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../features/auth/AuthContext';
import { MatchRow } from '../../features/matches/MatchRow';
import { useAsync } from '../../hooks/useAsync';
import { useSocketEvent } from '../../hooks/useSocket';
import { del, errorMessage, get, getPaged, post } from '../../services/api/client';
import type { Invitation, MatchListItem, PublicUser, TimeControlPreset } from '../../types/api';
import { formatTimeControl, relativeTime } from '../../utils/format';

function TimeControlPicker({ presets, value, onChange }: { presets: TimeControlPreset[]; value: string; onChange: (id: string) => void }) {
  const groups = ['bullet', 'blitz', 'rapid'] as const;
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-stone-700">Time control</legend>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g} className="flex flex-wrap items-center gap-2">
            <span className="w-14 text-xs font-medium uppercase text-stone-500">{g}</span>
            {presets
              .filter((p) => p.category === g)
              .map((p) => (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={value === p.id}
                  onClick={() => onChange(p.id)}
                  className={cx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium tabular-nums ring-1 transition-colors',
                    value === p.id ? 'bg-green-800 text-white ring-green-800' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50',
                  )}
                >
                  {p.label}
                </button>
              ))}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function LobbyPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const presets = useAsync(() => get<TimeControlPreset[]>('/time-controls'), []);
  const open = useAsync(() => getPaged<MatchListItem>('/matches', { scope: 'open', pageSize: 20 }), []);
  const mine = useAsync(
    () =>
      Promise.all(
        (['IN_PROGRESS', 'READY', 'WAITING', 'CREATED'] as const).map((status) =>
          getPaged<MatchListItem>('/matches', { scope: 'mine', status, pageSize: 20 }).then((r) => r.data),
        ),
      ).then((lists) => lists.flat()),
    [],
  );
  const invitations = useAsync(() => get<Invitation[]>('/matches/invitations'), []);
  const queue = useAsync(() => get<{ entry: { initialTimeMs: number; incrementMs: number; createdAt: string } | null; playersWaiting: number }>('/matches/queue'), []);

  const [tc, setTc] = useState('5+3');
  const [color, setColor] = useState<'random' | 'white' | 'black'>('random');
  const [rated, setRated] = useState(true);
  const [opponent, setOpponent] = useState<PublicUser | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reloadAll = () => {
    void open.reload();
    void mine.reload();
    void invitations.reload();
    void queue.reload();
  };

  useSocketEvent<{ matchId: string }>('matchmaking:matched', ({ matchId }) => {
    toast.success('Opponent found!');
    navigate(`/games/${matchId}`);
  });
  useSocketEvent<{ matchId: string }>('match:ready', ({ matchId }) => {
    toast.success('Your challenge was accepted.');
    navigate(`/games/${matchId}`);
  });
  useSocketEvent('notification:new', () => reloadAll());

  // Refresh the open-challenge list periodically.
  useEffect(() => {
    const t = setInterval(() => void open.reload(), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = presets.data?.find((p) => p.id === tc);

  async function act<T>(key: string, fn: () => Promise<T>, onOk?: (r: T) => void) {
    setBusy(key);
    try {
      const r = await fn();
      onOk?.(r);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const inQueue = Boolean(queue.data?.entry);
  const incoming = (invitations.data ?? []).filter((i) => i.inviteeId === user?.id);
  const outgoing = (invitations.data ?? []).filter((i) => i.inviterId === user?.id);

  return (
    <div>
      <PageHeader title="Play" description="Challenge a player, join an open game, or find an opponent automatically." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-6">
          <Card title="Create a game">
            {presets.loading ? (
              <Spinner />
            ) : presets.error ? (
              <ErrorState message={presets.error} onRetry={presets.reload} />
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!preset) return;
                  void act(
                    'create',
                    () =>
                      post<{ id: string }>('/matches', {
                        initialTimeMs: preset.initialTimeMs,
                        incrementMs: preset.incrementMs,
                        color,
                        rated,
                        isPrivate: opponent ? isPrivate : false,
                        ...(opponent ? { opponentId: opponent.id } : {}),
                      }),
                    (r) => {
                      toast.success(opponent ? `Challenge sent to ${opponent.displayName}` : 'Open challenge created');
                      navigate(`/games/${r.id}`);
                    },
                  );
                }}
              >
                <TimeControlPicker presets={presets.data ?? []} value={tc} onChange={setTc} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label="Your colour" value={color} onChange={(e) => setColor(e.target.value as typeof color)}>
                    <option value="random">Random</option>
                    <option value="white">White</option>
                    <option value="black">Black</option>
                  </Select>
                  <Select label="Mode" value={rated ? 'rated' : 'casual'} onChange={(e) => setRated(e.target.value === 'rated')}>
                    <option value="rated">Rated</option>
                    <option value="casual">Casual</option>
                  </Select>
                </div>
                <PlayerPicker label="Invite a specific player (optional)" value={opponent} onChange={setOpponent} excludeIds={user ? [user.id] : []} />
                {opponent && (
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="size-4 accent-green-800" />
                    Private game (hidden from public replays)
                  </label>
                )}
                <Button type="submit" icon={<Swords className="size-4" />} loading={busy === 'create'} className="w-full">
                  {opponent ? 'Send challenge' : 'Create open challenge'}
                </Button>
              </form>
            )}
          </Card>

          <Card title="Quick pairing" action={<span className="text-xs text-stone-500">{queue.data?.playersWaiting ?? 0} waiting</span>}>
            {inQueue && queue.data?.entry ? (
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-stone-700">
                  <Loader2 className="size-4 animate-spin text-green-700" aria-hidden />
                  Searching for a {formatTimeControl(queue.data.entry.initialTimeMs, queue.data.entry.incrementMs)} opponent…
                </p>
                <Button variant="secondary" size="sm" loading={busy === 'dequeue'} onClick={() => void act('dequeue', () => del('/matches/queue'), () => void queue.reload())}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-stone-600">Get matched with a player of similar rating using the time control selected above.</p>
                <Button
                  variant="secondary"
                  icon={<Users className="size-4" />}
                  loading={busy === 'queue'}
                  disabled={!preset}
                  onClick={() =>
                    preset &&
                    void act('queue', () => post<{ queued: boolean; matchId?: string }>('/matches/queue', { initialTimeMs: preset.initialTimeMs, incrementMs: preset.incrementMs, rated }), (r) => {
                      if (r.matchId) navigate(`/games/${r.matchId}`);
                      else void queue.reload();
                    })
                  }
                >
                  Find opponent ({tc})
                </Button>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={<span className="flex items-center gap-2">Invitations {incoming.length > 0 && <Badge tone="green">{incoming.length}</Badge>}</span>}>
            {invitations.loading ? (
              <Spinner />
            ) : incoming.length === 0 && outgoing.length === 0 ? (
              <EmptyState icon={<Inbox className="size-6" />} title="No pending invitations" />
            ) : (
              <ul className="divide-y divide-stone-100">
                {incoming.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="text-sm">
                      <p className="font-medium text-stone-900">
                        {i.inviter.displayName} <span className="text-stone-500">({i.inviter.profile?.rating ?? '—'})</span>
                      </p>
                      <p className="text-xs text-stone-500">
                        {formatTimeControl(i.match.initialTimeMs, i.match.incrementMs)} · {i.match.rated ? 'Rated' : 'Casual'} · you play{' '}
                        {i.match.whitePlayerId === user?.id ? 'White' : 'Black'} · {relativeTime(i.createdAt)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" loading={busy === `acc-${i.id}`} onClick={() => void act(`acc-${i.id}`, () => post<{ matchId: string }>(`/matches/invitations/${i.id}/accept`), (r) => navigate(`/games/${r.matchId}`))}>
                        Accept
                      </Button>
                      <Button size="sm" variant="secondary" loading={busy === `dec-${i.id}`} onClick={() => void act(`dec-${i.id}`, () => post(`/matches/invitations/${i.id}/decline`), reloadAll)}>
                        Decline
                      </Button>
                    </div>
                  </li>
                ))}
                {outgoing.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                    <span>
                      Waiting for <strong>{i.invitee.displayName}</strong> · {formatTimeControl(i.match.initialTimeMs, i.match.incrementMs)}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-stone-500">
                      <Clock3 className="size-3.5" /> expires {new Date(i.expiresAt).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Your games">
            {mine.loading ? (
              <Spinner />
            ) : mine.error ? (
              <ErrorState message={mine.error} onRetry={mine.reload} />
            ) : (mine.data ?? []).length === 0 ? (
              <EmptyState title="No active or upcoming games" />
            ) : (
              <div className="-mx-3">
                {(mine.data ?? []).map((m) => (
                  <MatchRow key={m.id} m={m} viewerId={user?.id} />
                ))}
              </div>
            )}
          </Card>

          <Card title="Open challenges" action={<button className="text-xs text-green-800 hover:underline" onClick={() => void open.reload()}>Refresh</button>}>
            {open.loading && !open.data ? (
              <Spinner />
            ) : open.error ? (
              <ErrorState message={open.error} onRetry={open.reload} />
            ) : (open.data?.data ?? []).length === 0 ? (
              <EmptyState title="No open challenges right now">Create one and wait for an opponent.</EmptyState>
            ) : (
              <ul className="divide-y divide-stone-100">
                {(open.data?.data ?? []).map((m) => {
                  const creator = m.white ?? m.black;
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                      <div>
                        <p className="font-medium text-stone-900">
                          {creator?.displayName} <span className="text-stone-500">({creator?.rating ?? '—'})</span>
                        </p>
                        <p className="text-xs text-stone-500">
                          {formatTimeControl(m.initialTimeMs, m.incrementMs)} · {m.rated ? 'Rated' : 'Casual'} · you play {m.white ? 'Black' : 'White'}
                        </p>
                      </div>
                      <Button size="sm" loading={busy === `join-${m.id}`} onClick={() => void act(`join-${m.id}`, () => post<{ id: string }>(`/matches/${m.id}/join`), (r) => navigate(`/games/${r.id}`))}>
                        Join
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
