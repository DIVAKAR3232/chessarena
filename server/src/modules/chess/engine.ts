/**
 * Authoritative chess rules engine. Pure module: no database, Express or Socket.IO imports.
 *
 * Built on chess.js for move generation/validation, plus FIDE rules chess.js does not apply
 * automatically:
 *  - Automatic terminations: checkmate, stalemate, insufficient material (dead position),
 *    fivefold repetition, 75-move rule.
 *  - Claimable draws (not automatic): threefold repetition, 50-move rule.
 *  - Timeout vs insufficient mating material.
 *
 * chess.js' isDraw()/isGameOver() treat threefold and 50-move as automatic, so they are NOT used.
 */
import { Chess, type Move, type Square } from 'chess.js';

export const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type Color = 'w' | 'b';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface MoveInput {
  from: string;
  to: string;
  promotion?: PromotionPiece | null;
}

export interface AppliedMove {
  from: string;
  to: string;
  promotion: PromotionPiece | null;
  san: string;
  lan: string;
  color: Color;
  fenAfter: string;
  captured: string | null;
  isCheck: boolean;
}

export type AutoTermination =
  | 'CHECKMATE'
  | 'STALEMATE'
  | 'INSUFFICIENT_MATERIAL'
  | 'FIVEFOLD_REPETITION'
  | 'SEVENTY_FIVE_MOVE_RULE';

export type DrawClaim = 'THREEFOLD_REPETITION' | 'FIFTY_MOVE_RULE';

export interface Termination {
  reason: AutoTermination;
  /** Winning colour, or null for a draw. */
  winner: Color | null;
}

export class IllegalMoveError extends Error {
  constructor(message = 'Illegal move') {
    super(message);
    this.name = 'IllegalMoveError';
  }
}

const SQUARE_RE = /^[a-h][1-8]$/;

export class GameEngine {
  private readonly chess: Chess;
  private readonly positionCounts = new Map<string, number>();
  readonly initialFen: string;

  private constructor(initialFen: string) {
    this.initialFen = initialFen;
    try {
      this.chess = new Chess(initialFen);
    } catch {
      throw new Error('Invalid initial FEN');
    }
    this.recordPosition();
  }

  /** Creates an engine and replays the persisted move list (needed for repetition detection). */
  static fromMoves(initialFen: string, moves: readonly MoveInput[]): GameEngine {
    const engine = new GameEngine(initialFen);
    for (const m of moves) engine.applyMove(m);
    return engine;
  }

  static isValidFen(fen: string): boolean {
    try {
      new Chess(fen);
      return true;
    } catch {
      return false;
    }
  }

  get turn(): Color {
    return this.chess.turn();
  }

  get fen(): string {
    return this.chess.fen();
  }

  get ply(): number {
    return this.chess.history().length;
  }

  get inCheck(): boolean {
    return this.chess.inCheck();
  }

  get halfmoveClock(): number {
    return Number(this.chess.fen().split(' ')[4] ?? 0);
  }

  history(): string[] {
    return this.chess.history();
  }

  legalMoves(): Move[] {
    return this.chess.moves({ verbose: true });
  }

  /** Validates and applies a move. Throws IllegalMoveError if it is not legal in this position. */
  applyMove(input: MoveInput): AppliedMove {
    if (!SQUARE_RE.test(input.from) || !SQUARE_RE.test(input.to)) {
      throw new IllegalMoveError('Invalid square');
    }
    if (this.terminationStatus()) throw new IllegalMoveError('The game is already over');

    const candidates = this.chess
      .moves({ square: input.from as Square, verbose: true })
      .filter((m) => m.to === input.to);
    if (candidates.length === 0) throw new IllegalMoveError();

    const needsPromotion = candidates.some((m) => m.promotion);
    if (needsPromotion && !input.promotion) {
      throw new IllegalMoveError('A promotion piece (q, r, b or n) is required');
    }
    if (!needsPromotion && input.promotion) {
      throw new IllegalMoveError('Promotion is only allowed when a pawn reaches the last rank');
    }

    let move: Move;
    try {
      move = this.chess.move({
        from: input.from,
        to: input.to,
        ...(needsPromotion ? { promotion: input.promotion ?? undefined } : {}),
      });
    } catch {
      throw new IllegalMoveError();
    }
    this.recordPosition();
    return {
      from: move.from,
      to: move.to,
      promotion: (move.promotion as PromotionPiece | undefined) ?? null,
      san: move.san,
      lan: move.lan,
      color: move.color,
      fenAfter: move.after,
      captured: move.captured ?? null,
      isCheck: this.chess.inCheck(),
    };
  }

  /** Automatic game-ending conditions after the last move (checkmate takes precedence). */
  terminationStatus(): Termination | null {
    if (this.chess.isCheckmate()) {
      return { reason: 'CHECKMATE', winner: this.chess.turn() === 'w' ? 'b' : 'w' };
    }
    if (this.chess.isStalemate()) return { reason: 'STALEMATE', winner: null };
    if (this.chess.isInsufficientMaterial()) return { reason: 'INSUFFICIENT_MATERIAL', winner: null };
    if (this.currentPositionCount() >= 5) return { reason: 'FIVEFOLD_REPETITION', winner: null };
    if (this.halfmoveClock >= 150) return { reason: 'SEVENTY_FIVE_MOVE_RULE', winner: null };
    return null;
  }

  /** Draw the player to move (or either player) may claim in the current position. */
  claimableDraw(): DrawClaim | null {
    if (this.terminationStatus()) return null;
    if (this.currentPositionCount() >= 3) return 'THREEFOLD_REPETITION';
    if (this.halfmoveClock >= 100) return 'FIFTY_MOVE_RULE';
    return null;
  }

  /**
   * Whether `color` could deliver checkmate by any legal sequence. Used when the opponent's flag
   * falls: if `color` cannot mate, the game is drawn instead of lost (FIDE 6.9).
   * Conservative implementation: a bare king, or a dead position for both sides, cannot mate.
   */
  hasMatingMaterial(color: Color): boolean {
    const pieces = this.chess
      .board()
      .flat()
      .filter((p): p is NonNullable<typeof p> => p !== null && p.color === color);
    if (pieces.length === 1) return false; // bare king
    if (this.chess.isInsufficientMaterial()) return false;
    return true;
  }

  pgn(headers: Record<string, string> = {}): string {
    for (const [k, v] of Object.entries(headers)) this.chess.setHeader(k, v);
    return this.chess.pgn();
  }

  private currentPositionCount(): number {
    return this.positionCounts.get(this.positionKey()) ?? 0;
  }

  private recordPosition() {
    const key = this.positionKey();
    this.positionCounts.set(key, (this.positionCounts.get(key) ?? 0) + 1);
  }

  /**
   * Repetition key: placement, side to move, castling rights and en passant square — the latter
   * only when an en passant capture is actually legal (FIDE 9.2.3).
   */
  private positionKey(): string {
    const [placement, turn, castling, ep] = this.chess.fen().split(' ');
    let epKey = '-';
    if (ep && ep !== '-') {
      const epLegal = this.chess.moves({ verbose: true }).some((m) => m.isEnPassant());
      if (epLegal) epKey = ep;
    }
    return `${placement} ${turn} ${castling} ${epKey}`;
  }
}

export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');
