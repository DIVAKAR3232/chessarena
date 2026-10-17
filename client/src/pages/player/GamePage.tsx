import { ArrowLeft, Flag, Handshake, RefreshCw, Scale, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, Button, Card, ErrorState, Spinner, cx } from '../../components/ui';
import { ConfirmDialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../features/auth/AuthContext';
import { capturedPieces } from '../../features/chess/captured';
import { ChessBoardView } from '../../features/chess/ChessBoardView';
import { Clock } from '../../features/chess/Clock';
import { MoveList } from '../../features/chess/MoveList';
import { useMatch } from '../../features/chess/useMatch';
import { post } from '../../services/api/client';
import type { MatchState, PlayerCard } from '../../types/api';
import { formatTimeControl, humanize, resultToken, statusTone } from '../../utils/format';

function PlayerBar({
  player,
  color,
  clockMs,
  running,
  receivedAt,
  connected,
  graceUntil,
  captured,
  advantage,
  isYou,
}: {
  player: PlayerCard | null;
  color: 'w' | 'b';
  clockMs: number;
  running: boolean;
  receivedAt: number;
  connected: boolean;
  graceUntil: number | null;
  captured: string;
  advantage: number;
  isYou: boolean;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!graceUntil) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [graceUntil]);
  const graceLeft = graceUntil ? Math.max(0, Math.ceil((graceUntil - Date.now()) / 1000)) : null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-stone-200">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={cx('size-3 shrink-0 rounded-full ring-1 ring-stone-400', color === 'w' ? 'bg-white' : 'bg-stone-900')} aria-label={color === 'w' ? 'White' : 'Black'} />
          {player ? (
            <Link to={`/players/${player.id}`} className="truncate font-medium text-stone-900 hover:underline">
              {player.displayName}
            </Link>
          ) : (
            <span className="text-stone-500">Waiting for opponent…</span>
          )}
          {player?.rating != null && <span className="text-sm text-stone-500 tabular-nums">({player.rating})</span>}
          {isYou && <Badge tone="green">You</Badge>}
          {player && (connected ? <Wifi className="size-3.5 text-green-700" aria-label="Connected" /> : <WifiOff className="size-3.5 text-red-600" aria-label="Disconnected" />)}
        </div>
        <div className="mt-0.5 flex h-5 items-center gap-1 text-sm text-stone-600">
          <span className="truncate leading-none">{captured}</span>
          {advantage > 0 && <span className="text-xs text-stone-500">+{advantage}</span>}
          {graceLeft !== null && !connected && <span className="text-xs text-amber-700">Reconnecting… {graceLeft}s</span>}
        </div>
      </div>
      <Clock ms={clockMs} running={running} receivedAt={receivedAt} />
    </div>
  );
}

function statusLine(s: MatchState, myId: string | undefined): string {
  switch (s.status) {
    case 'CREATED':
      return 'Open challenge — waiting for someone to accept.';
    case 'WAITING':
      return 'Waiting for the invited player to accept.';
    case 'READY': {
      const meWhite = s.white?.id === myId;
      const iJoined = meWhite ? s.whiteJoined : s.blackJoined;
      const oppJoined = meWhite ? s.blackJoined : s.whiteJoined;
      if (s.scheduledAt && new Date(s.scheduledAt) > new Date()) return `Scheduled for ${new Date(s.scheduledAt).toLocaleString()}.`;
      if (iJoined && !oppJoined) return 'Waiting for your opponent to join the board…';
      return 'Both players must open the board to start.';
    }
    case 'IN_PROGRESS':
      return s.turn === 'w' ? 'White to move' : 'Black to move';
    case 'COMPLETED':
    case 'ABANDONED':
    case 'DISPUTED': {
      const who = s.result === 'WHITE_WIN' ? 'White wins' : s.result === 'BLACK_WIN' ? 'Black wins' : s.result === 'DRAW' ? 'Draw' : 'No result';
      return `${who} · ${humanize(s.terminationReason)}`;
    }
    case 'CANCELLED':
      return `Cancelled${s.cancelReason ? `: ${s.cancelReason}` : ''}`;
  }
}

export function GamePage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const m = useMatch(id);
  const [confirm, setConfirm] = useState<null | 'resign' | 'cancel' | 'dispute'>(null);
  const s = m.state;

  const myColor: 'w' | 'b' | null = s && user ? (s.white?.id === user.id ? 'w' : s.black?.id === user.id ? 'b' : null) : null;
  const orientation = myColor === 'b' ? 'black' : 'white';
  const inProgress = s?.status === 'IN_PROGRESS';
  const lastMove = s && s.moves.length ? s.moves[s.moves.length - 1]! : null;
  const captured = useMemo(() => (s ? capturedPieces(s.fen) : null), [s]);

  // Event toasts
  useEffect(() => {
    const e = m.lastEvent;
    if (!e || !user) return;
    if (e.type === 'draw-offered' && (e.payload as { offeredBy: string }).offeredBy !== user.id) toast.info('Your opponent offers a draw.');
    if (e.type === 'draw-declined' && (e.payload as { declinedBy: string }).declinedBy !== user.id) toast.info('Draw offer declined.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.lastEvent]);

  if (m.error && !s) return <ErrorState message={m.error} onRetry={() => void m.resync()} />;
  if (!s) return <Spinner label="Joining game…" />;

  const top = orientation === 'white' ? 'b' : 'w';
  const bottom = top === 'w' ? 'b' : 'w';
  const playerOf = (c: 'w' | 'b') => (c === 'w' ? s.white : s.black);
  const pres = (c: 'w' | 'b') => {
    const p = playerOf(c);
    const fromEvents = p ? m.presence[p.id] : undefined;
    return { connected: fromEvents?.connected ?? (c === 'w' ? s.whiteConnected : s.blackConnected), graceUntil: fromEvents?.graceUntil ?? null };
  };
  const bar = (c: 'w' | 'b') => (
    <PlayerBar
      player={playerOf(c)}
      color={c}
      clockMs={c === 'w' ? s.clocks.white : s.clocks.black}
      running={s.clocks.running === c}
      receivedAt={m.receivedAt}
      {...pres(c)}
      captured={captured ? (c === 'w' ? captured.byWhite : captured.byBlack) : ''}
      advantage={captured ? (c === 'w' ? captured.advantage : -captured.advantage) : 0}
      isYou={myColor === c}
    />
  );

  const opponentOffer = s.drawOffer && s.drawOffer.offeredBy !== user?.id;
  const myOffer = s.drawOffer && s.drawOffer.offeredBy === user?.id;
  const finished = ['COMPLETED', 'ABANDONED', 'DISPUTED', 'CANCELLED'].includes(s.status);
  const canCancel = ['CREATED', 'WAITING', 'READY'].includes(s.status) && !s.tournament && (s.createdById === user?.id || myColor);

  async function run(p: Promise<{ ok: boolean; message?: string }>, success?: string) {
    const r = await p;
    if (!r.ok) toast.error(r.message ?? 'Action failed');
    else if (success) toast.success(success);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="mx-auto w-full max-w-[min(100%,78vh)] space-y-2">
        {bar(top)}
        <ChessBoardView
          fen={s.fen}
          orientation={orientation}
          myColor={myColor}
          canMove={inProgress && myColor === s.turn}
          lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
          onMove={async (from, to, promotion) => {
            const r = await m.move(from, to, promotion);
            if (!r.ok) toast.error(r.message ?? 'Move rejected');
            return r.ok;
          }}
        />
        {bar(bottom)}
      </div>

      <aside className="space-y-4">
        <Card
          title={
            <span className="flex items-center gap-2">
              <Link to={myColor ? '/play/lobby' : '/'} className="text-stone-400 hover:text-stone-700" aria-label="Back">
                <ArrowLeft className="size-4" />
              </Link>
              {formatTimeControl(s.initialTimeMs, s.incrementMs)} · {s.rated ? 'Rated' : 'Casual'}
            </span>
          }
          action={<Badge tone={statusTone(s.status)}>{humanize(s.status)}</Badge>}
        >
          <p className={cx('text-sm', finished ? 'font-semibold text-stone-900' : 'text-stone-700')}>
            {finished && s.result && <span className="mr-2 font-mono">{resultToken(s.result)}</span>}
            {statusLine(s, user?.id)}
          </p>
          {s.tournament && (
            <p className="mt-1 text-xs text-stone-500">
              {s.tournament.name}
              {s.round ? ` · Round ${s.round.roundNumber}` : ''}
            </p>
          )}
          {m.role === 'spectator' && <p className="mt-2 text-xs text-stone-500">You are observing this game (read-only).</p>}
        </Card>

        {myColor && inProgress && (
          <Card title="Game controls">
            {opponentOffer && (
              <div className="mb-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                <p className="font-medium text-green-900">Your opponent offers a draw</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => void run(m.respondDraw(true))}>
                    Accept
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void run(m.respondDraw(false))}>
                    Decline
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<Handshake className="size-4" />} disabled={Boolean(s.drawOffer)} onClick={() => void run(m.offerDraw(), 'Draw offered')}>
                {myOffer ? 'Draw offered' : 'Offer draw'}
              </Button>
              {s.claimableDraw && (
                <Button size="sm" variant="secondary" icon={<Scale className="size-4" />} onClick={() => void run(m.claimDraw())}>
                  Claim draw ({humanize(s.claimableDraw)})
                </Button>
              )}
              <Button size="sm" variant="danger" icon={<Flag className="size-4" />} onClick={() => setConfirm('resign')}>
                Resign
              </Button>
            </div>
          </Card>
        )}

        {canCancel && (
          <Card>
            <Button variant="secondary" size="sm" onClick={() => setConfirm('cancel')}>
              Cancel this game
            </Button>
          </Card>
        )}

        <Card
          title="Moves"
          action={
            <button className="text-stone-400 hover:text-stone-700" onClick={() => void m.resync()} aria-label="Resync with server" title="Resync">
              <RefreshCw className="size-4" />
            </button>
          }
        >
          <MoveList sans={s.moves.map((mv) => mv.san)} />
          {finished && s.moves.length > 0 && (
            <Link to={`/games/${s.id}/replay`} className="mt-3 inline-block text-sm font-medium text-green-800 hover:underline">
              Open replay
            </Link>
          )}
          {(myColor || user?.role === 'COORDINATOR') && (s.status === 'COMPLETED' || s.status === 'ABANDONED') && (
            <button className="mt-3 ml-4 text-sm text-stone-500 hover:text-stone-800 hover:underline" onClick={() => setConfirm('dispute')}>
              Dispute result
            </button>
          )}
        </Card>
      </aside>

      <ConfirmDialog
        open={confirm === 'resign'}
        title="Resign this game?"
        message="Your opponent will be awarded the win."
        confirmLabel="Resign"
        tone="danger"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await run(m.resign());
        }}
      />
      <ConfirmDialog
        open={confirm === 'dispute'}
        title="Dispute this result?"
        message="An administrator will review the game. Describe the problem in at least 10 characters. The result stays as recorded until the review is complete."
        confirmLabel="Submit dispute"
        requireReason
        onClose={() => setConfirm(null)}
        onConfirm={async (reason) => {
          try {
            await post(`/matches/${s.id}/disputes`, { reason });
            toast.success('Dispute submitted to the administrators');
            void m.resync();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not submit');
          }
        }}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title="Cancel this game?"
        message="The game has not started yet. Your opponent will be notified."
        confirmLabel="Cancel game"
        tone="danger"
        requireReason
        onClose={() => setConfirm(null)}
        onConfirm={async (reason) => {
          try {
            await post(`/matches/${s.id}/cancel`, { reason });
            toast.success('Game cancelled');
            void m.resync();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not cancel');
          }
        }}
      />
    </div>
  );
}
