import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Copy, FlipVertical2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, ErrorState, PageHeader, Spinner } from '../../components/ui';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../features/auth/AuthContext';
import { ChessBoardView } from '../../features/chess/ChessBoardView';
import { MoveList } from '../../features/chess/MoveList';
import { useAsync } from '../../hooks/useAsync';
import { get } from '../../services/api/client';
import type { MatchState } from '../../types/api';
import { formatClock, formatTimeControl, humanize, resultToken } from '../../utils/format';

interface Replay {
  matchId: string;
  initialFen: string;
  result: string | null;
  terminationReason: string | null;
  pgn: string;
  moves: { ply: number; san: string; from: string; to: string; fen: string; clockAfterMs: number }[];
}

export function ReplayPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const data = useAsync(() => Promise.all([get<Replay>(`/matches/${id}/replay`), get<MatchState>(`/matches/${id}`)]), [id]);
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const replay = data.data?.[0];
  const match = data.data?.[1];
  const total = replay?.moves.length ?? 0;

  useEffect(() => setPly(total), [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      if (e.key === 'ArrowRight') setPly((p) => Math.min(total, p + 1));
      if (e.key === 'Home') setPly(0);
      if (e.key === 'End') setPly(total);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  if (data.loading && !data.data) return <Spinner />;
  if (data.error || !replay || !match) return <ErrorState message={data.error ?? 'Not found'} onRetry={data.reload} />;

  const fen = ply === 0 ? replay.initialFen : replay.moves[ply - 1]!.fen;
  const current = ply > 0 ? replay.moves[ply - 1]! : null;
  const meBlack = match.black?.id === user?.id;
  const orientation = (meBlack !== flipped) ? 'black' : 'white';

  return (
    <div>
      <PageHeader
        title={`${match.white?.displayName ?? '?'} vs ${match.black?.displayName ?? '?'}`}
        description={`${resultToken(match.result)} · ${humanize(match.terminationReason)} · ${formatTimeControl(match.initialTimeMs, match.incrementMs)} · ${match.rated ? 'Rated' : 'Casual'}`}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="mx-auto w-full max-w-[min(100%,78vh)] space-y-3">
          <ChessBoardView fen={fen} orientation={orientation} myColor={null} canMove={false} lastMove={current ? { from: current.from, to: current.to } : null} />
          <div className="flex items-center justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPly(0)} aria-label="First move"><ChevronFirst className="size-4" /></Button>
            <Button variant="secondary" size="sm" onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label="Previous move"><ChevronLeft className="size-4" /></Button>
            <span className="w-20 text-center text-sm text-stone-600 tabular-nums">{ply} / {total}</span>
            <Button variant="secondary" size="sm" onClick={() => setPly((p) => Math.min(total, p + 1))} aria-label="Next move"><ChevronRight className="size-4" /></Button>
            <Button variant="secondary" size="sm" onClick={() => setPly(total)} aria-label="Last move"><ChevronLast className="size-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setFlipped((f) => !f)} aria-label="Flip board"><FlipVertical2 className="size-4" /></Button>
          </div>
        </div>
        <aside className="space-y-4">
          <Card title="Moves">
            <MoveList sans={replay.moves.map((m) => m.san)} activePly={ply} onSelect={setPly} />
            {current && <p className="mt-2 text-xs text-stone-500">Clock after {current.san}: {formatClock(current.clockAfterMs)}</p>}
          </Card>
          <Card
            title="PGN"
            action={
              <button
                className="flex items-center gap-1 text-xs text-green-800 hover:underline"
                onClick={() => navigator.clipboard.writeText(replay.pgn).then(() => toast.success('PGN copied'), () => toast.error('Copy failed'))}
              >
                <Copy className="size-3.5" /> Copy
              </button>
            }
          >
            <pre className="max-h-40 overflow-auto text-xs whitespace-pre-wrap text-stone-700">{replay.pgn || '—'}</pre>
          </Card>
          <Link to={`/games/${id}`} className="block text-sm text-green-800 hover:underline">Game details</Link>
        </aside>
      </div>
    </div>
  );
}
