import { Chess, type Square } from 'chess.js';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Chessboard, type PieceDropHandlerArgs, type SquareHandlerArgs } from 'react-chessboard';
import { Dialog } from '../../components/ui/dialog';

export type Promotion = 'q' | 'r' | 'b' | 'n';

interface Props {
  /** Authoritative position from the server. */
  fen: string;
  orientation: 'white' | 'black';
  /** Colour the viewer controls, or null for spectators / replays. */
  myColor: 'w' | 'b' | null;
  /** Whether moves are currently allowed (game in progress and it is the viewer's turn). */
  canMove: boolean;
  lastMove?: { from: string; to: string } | null;
  /**
   * Submits a move. Resolve true when the server accepted it; false restores the authoritative
   * position (optimistic UI with rollback).
   */
  onMove?: (from: string, to: string, promotion?: Promotion) => Promise<boolean>;
}

const LIGHT = '#eeeed2';
const DARK = '#769656';

/**
 * Board UI. chess.js here is only used to show legal-move hints and an optimistic position; the
 * server validates every move independently.
 */
export function ChessBoardView({ fen, orientation, myColor, canMove, lastMove, onMove }: Props) {
  const [displayFen, setDisplayFen] = useState(fen);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Any new authoritative position replaces the optimistic one.
  useEffect(() => {
    setDisplayFen(fen);
    setSelected(null);
  }, [fen]);

  const game = useMemo(() => {
    try {
      return new Chess(displayFen);
    } catch {
      return new Chess();
    }
  }, [displayFen]);

  const interactive = Boolean(canMove && myColor && onMove && !submitting && game.turn() === myColor);

  const legalTargets = useMemo(() => {
    if (!selected) return [];
    return game.moves({ square: selected as Square, verbose: true }).map((m) => ({ to: m.to, capture: Boolean(m.captured) }));
  }, [game, selected]);

  const checkSquare = useMemo(() => {
    if (!game.inCheck()) return null;
    for (const row of game.board()) for (const p of row) if (p && p.type === 'k' && p.color === game.turn()) return p.square;
    return null;
  }, [game]);

  const isPromotion = (from: string, to: string) =>
    game.moves({ square: from as Square, verbose: true }).some((m) => m.to === to && m.promotion);

  async function submit(from: string, to: string, promotion?: Promotion) {
    if (!onMove) return false;
    // Optimistic local position; rolled back if the server rejects.
    const copy = new Chess(displayFen);
    try {
      copy.move({ from, to, promotion });
    } catch {
      return false;
    }
    setDisplayFen(copy.fen());
    setSelected(null);
    setSubmitting(true);
    const ok = await onMove(from, to, promotion);
    setSubmitting(false);
    if (!ok) setDisplayFen(fen);
    return true;
  }

  function tryMove(from: string, to: string): boolean {
    if (!interactive) return false;
    const legal = game.moves({ square: from as Square, verbose: true }).some((m) => m.to === to);
    if (!legal) return false;
    if (isPromotion(from, to)) {
      setPendingPromotion({ from, to });
      return false;
    }
    void submit(from, to);
    return true;
  }

  function onSquareClick({ square, piece }: SquareHandlerArgs) {
    if (!interactive) return;
    const ownPiece = piece && piece.pieceType[0] === myColor;
    if (selected && legalTargets.some((t) => t.to === square)) {
      tryMove(selected, square);
      return;
    }
    setSelected(ownPiece ? (selected === square ? null : square) : null);
  }

  function onPieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false;
    return tryMove(sourceSquare, targetSquare);
  }

  const squareStyles: Record<string, CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { backgroundColor: 'rgba(250, 204, 21, 0.45)' };
    squareStyles[lastMove.to] = { backgroundColor: 'rgba(250, 204, 21, 0.45)' };
  }
  if (selected) squareStyles[selected] = { backgroundColor: 'rgba(22, 101, 52, 0.45)' };
  for (const t of legalTargets) {
    squareStyles[t.to] = t.capture
      ? { ...squareStyles[t.to], background: 'radial-gradient(transparent 58%, rgba(20, 83, 45, 0.55) 60%)' }
      : { ...squareStyles[t.to], background: 'radial-gradient(rgba(20, 83, 45, 0.5) 22%, transparent 24%)' };
  }
  if (checkSquare) {
    squareStyles[checkSquare] = { ...squareStyles[checkSquare], background: 'radial-gradient(rgba(220, 38, 38, 0.85) 15%, rgba(220, 38, 38, 0.35) 60%, transparent 75%)' };
  }

  return (
    <div className="touch-none select-none" style={{ WebkitUserSelect: 'none' }}>
      <Chessboard
        options={{
          id: 'arena-board',
          position: displayFen,
          boardOrientation: orientation,
          allowDragging: interactive,
          canDragPiece: ({ piece }) => interactive && piece.pieceType[0] === myColor,
          onPieceDrop,
          onSquareClick,
          onPieceDrag: ({ square }) => {
            if (interactive && square) setSelected(square);
          },
          squareStyles,
          lightSquareStyle: { backgroundColor: LIGHT },
          darkSquareStyle: { backgroundColor: DARK },
          boardStyle: { borderRadius: '0.5rem', overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)' },
          animationDurationInMs: 180,
          allowDrawingArrows: true,
        }}
      />
      <Dialog open={Boolean(pendingPromotion)} title="Promote pawn to" onClose={() => setPendingPromotion(null)}>
        <div className="grid grid-cols-4 gap-2">
          {(['q', 'r', 'b', 'n'] as const).map((p) => (
            <button
              key={p}
              className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 p-3 text-3xl hover:border-green-700 hover:bg-green-50"
              onClick={() => {
                const pr = pendingPromotion;
                setPendingPromotion(null);
                if (pr) void submit(pr.from, pr.to, p);
              }}
            >
              <span aria-hidden>{myColor === 'b' ? { q: '♛', r: '♜', b: '♝', n: '♞' }[p] : { q: '♕', r: '♖', b: '♗', n: '♘' }[p]}</span>
              <span className="text-xs text-stone-600">{{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p]}</span>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
