import { describe, expect, it } from 'vitest';
import { GameEngine, IllegalMoveError, STANDARD_FEN, type MoveInput } from './engine.js';

const uci = (s: string): MoveInput => ({
  from: s.slice(0, 2),
  to: s.slice(2, 4),
  promotion: (s[4] as MoveInput['promotion']) ?? undefined,
});
const play = (fen: string, moves: string[]) => GameEngine.fromMoves(fen, moves.map(uci));

describe('GameEngine — basic movement', () => {
  it('accepts standard opening moves and alternates turns', () => {
    const g = play(STANDARD_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(g.turn).toBe('w');
    expect(g.history()).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(g.ply).toBe(4);
  });

  it('accepts a double pawn step only from the starting rank', () => {
    const g = play(STANDARD_FEN, ['e2e4', 'a7a6']);
    expect(() => g.applyMove(uci('e4e6'))).toThrow(IllegalMoveError);
  });

  it('rejects illegal moves', () => {
    const g = play(STANDARD_FEN, []);
    expect(() => g.applyMove(uci('e2e5'))).toThrow(IllegalMoveError);
    expect(() => g.applyMove(uci('g1g3'))).toThrow(IllegalMoveError);
    expect(() => g.applyMove(uci('z9e4'))).toThrow(IllegalMoveError);
  });

  it('rejects moving the opponent pieces (out of turn)', () => {
    const g = play(STANDARD_FEN, []);
    expect(() => g.applyMove(uci('e7e5'))).toThrow(IllegalMoveError);
  });

  it('rejects moves that leave the own king in check', () => {
    // White king e1, pinned bishop e2 by black rook e8.
    const g = play('4r1k1/8/8/8/8/8/4B3/4K3 w - - 0 1', []);
    expect(() => g.applyMove(uci('e2d3'))).toThrow(IllegalMoveError);
    // King may not step into an attacked square.
    const g2 = play('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1', []);
    expect(() => g2.applyMove(uci('e1e2'))).toThrow(IllegalMoveError);
  });
});

describe('GameEngine — special moves', () => {
  it('allows castling on both sides when legal', () => {
    const k = play('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', []);
    expect(k.applyMove(uci('e1g1')).san).toBe('O-O');
    expect(k.applyMove(uci('e8c8')).san).toBe('O-O-O');
  });

  it('forbids castling through an attacked square', () => {
    const g = play('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1', []); // f1 attacked by Rf8
    expect(() => g.applyMove(uci('e1g1'))).toThrow(IllegalMoveError);
    expect(g.applyMove(uci('e1c1')).san).toBe('O-O-O');
  });

  it('forbids castling while in check', () => {
    const g = play('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1', []);
    expect(() => g.applyMove(uci('e1g1'))).toThrow(IllegalMoveError);
    expect(() => g.applyMove(uci('e1c1'))).toThrow(IllegalMoveError);
  });

  it('forbids castling after the king has moved', () => {
    const g = play('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1f1', 'a8b8', 'f1e1', 'b8a8']);
    expect(() => g.applyMove(uci('e1g1'))).toThrow(IllegalMoveError);
  });

  it('supports en passant immediately after the double step only', () => {
    const g = play(STANDARD_FEN, ['e2e4', 'a7a6', 'e4e5', 'd7d5']);
    const m = g.applyMove(uci('e5d6'));
    expect(m.san).toBe('exd6');
    expect(m.captured).toBe('p');

    const late = play(STANDARD_FEN, ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'h2h3', 'h7h6']);
    expect(() => late.applyMove(uci('e5d6'))).toThrow(IllegalMoveError);
  });

  it('requires a promotion piece and supports all four choices', () => {
    const fen = 'k7/4P3/8/8/8/8/8/7K w - - 0 1';
    expect(() => play(fen, []).applyMove(uci('e7e8'))).toThrow(/promotion piece/);
    for (const [p, san] of [
      ['q', 'e8=Q+'],
      ['r', 'e8=R+'],
      ['b', 'e8=B'],
      ['n', 'e8=N'],
    ] as const) {
      expect(play(fen, []).applyMove({ from: 'e7', to: 'e8', promotion: p }).san).toBe(san);
    }
  });

  it('rejects a promotion flag on a non-promoting move', () => {
    const g = play(STANDARD_FEN, []);
    expect(() => g.applyMove({ from: 'e2', to: 'e4', promotion: 'q' })).toThrow(IllegalMoveError);
  });
});

describe('GameEngine — terminal positions', () => {
  it('detects checkmate (scholar mate) with the correct winner', () => {
    const g = play(STANDARD_FEN, ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    expect(g.terminationStatus()).toEqual({ reason: 'CHECKMATE', winner: 'w' });
    expect(() => g.applyMove(uci('e8f7'))).toThrow(/already over/);
  });

  it('detects fool mate for black', () => {
    const g = play(STANDARD_FEN, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(g.terminationStatus()).toEqual({ reason: 'CHECKMATE', winner: 'b' });
  });

  it('detects stalemate', () => {
    const g = play('7k/8/6K1/5Q2/8/8/8/8 w - - 0 1', ['f5f7']);
    expect(g.terminationStatus()).toEqual({ reason: 'STALEMATE', winner: null });
  });

  it('detects insufficient material after a capture', () => {
    const g = play('8/8/8/4k3/8/8/3p4/4K3 w - - 0 1', ['e1d2']);
    expect(g.terminationStatus()).toEqual({ reason: 'INSUFFICIENT_MATERIAL', winner: null });
  });

  it('makes threefold repetition claimable but not automatic', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const g = play(STANDARD_FEN, [...shuffle, ...shuffle]);
    expect(g.terminationStatus()).toBeNull();
    expect(g.claimableDraw()).toBe('THREEFOLD_REPETITION');
    const twice = play(STANDARD_FEN, shuffle);
    expect(twice.claimableDraw()).toBeNull();
  });

  it('ends the game automatically on fivefold repetition', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const g = play(STANDARD_FEN, [...shuffle, ...shuffle, ...shuffle, ...shuffle]);
    expect(g.terminationStatus()).toEqual({ reason: 'FIVEFOLD_REPETITION', winner: null });
  });

  it('makes the fifty-move rule claimable at 100 half-moves', () => {
    const g = play('8/8/8/4k3/8/8/8/R3K3 w - - 98 60', ['a1a2']);
    expect(g.claimableDraw()).toBeNull();
    g.applyMove(uci('e5e6'));
    expect(g.claimableDraw()).toBe('FIFTY_MOVE_RULE');
    expect(g.terminationStatus()).toBeNull();
  });

  it('ends the game automatically under the seventy-five-move rule', () => {
    const g = play('8/8/8/4k3/8/8/8/R3K3 w - - 149 90', ['a1a2']);
    expect(g.terminationStatus()).toEqual({ reason: 'SEVENTY_FIVE_MOVE_RULE', winner: null });
  });

  it('a pawn move resets the fifty-move counter', () => {
    const g = play('8/8/8/4k3/8/8/P7/4K3 w - - 99 60', ['a2a3']);
    expect(g.halfmoveClock).toBe(0);
    expect(g.claimableDraw()).toBeNull();
  });
});

describe('GameEngine — mating material for timeouts', () => {
  it('a bare king cannot win on time', () => {
    const g = play('4k3/8/8/8/8/8/8/3QK3 w - - 0 1', []);
    expect(g.hasMatingMaterial('b')).toBe(false);
    expect(g.hasMatingMaterial('w')).toBe(true);
  });

  it('king and two knights can still win on time (helpmate possible)', () => {
    const g = play('4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1', []);
    expect(g.hasMatingMaterial('w')).toBe(true);
  });
});

describe('GameEngine — replay and PGN', () => {
  it('rebuilds identical state from the move list', () => {
    const moves = ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4'];
    const a = play(STANDARD_FEN, moves);
    const b = play(STANDARD_FEN, moves);
    expect(a.fen).toBe(b.fen);
    expect(a.pgn({ White: 'alice', Black: 'bob' })).toContain('1. e4 c5 2. Nf3 d6 3. d4 cxd4');
  });

  it('rejects an invalid initial FEN', () => {
    expect(GameEngine.isValidFen('not a fen')).toBe(false);
    expect(() => GameEngine.fromMoves('garbage', [])).toThrow();
  });
});
