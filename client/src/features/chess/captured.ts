const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };

/** Pieces captured by each side, derived from the current FEN (promotions approximated). */
export function capturedPieces(fen: string) {
  const placement = fen.split(' ')[0] ?? '';
  const count: Record<string, number> = {};
  for (const ch of placement) if (/[pnbrqPNBRQ]/.test(ch)) count[ch] = (count[ch] ?? 0) + 1;
  const missing = (color: 'w' | 'b') =>
    Object.keys(START).flatMap((t) => {
      const key = color === 'w' ? t.toUpperCase() : t;
      return Array(Math.max(0, START[t]! - (count[key] ?? 0))).fill(t) as string[];
    });
  const capturedByWhite = missing('b');
  const capturedByBlack = missing('w');
  const material = (list: string[]) => list.reduce((s, t) => s + VALUE[t]!, 0);
  return {
    byWhite: capturedByWhite.map((t) => GLYPH[t]!).join(''),
    byBlack: capturedByBlack.map((t) => GLYPH[t]!).join(''),
    advantage: material(capturedByWhite) - material(capturedByBlack),
  };
}
