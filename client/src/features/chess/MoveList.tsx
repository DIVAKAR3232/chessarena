import { useEffect, useRef } from 'react';
import { cx } from '../../components/ui';

interface Props {
  sans: string[];
  /** Highlighted ply (1-based); defaults to the last move. */
  activePly?: number;
  onSelect?: (ply: number) => void;
}

export function MoveList({ sans, activePly, onSelect }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const active = activePly ?? sans.length;

  // Keep the newest move visible by scrolling only this list's own box. (scrollIntoView would
  // also scroll the page, making the board jump on every move.)
  useEffect(() => {
    const box = boxRef.current;
    if (box && activePly === undefined) box.scrollTop = box.scrollHeight;
  }, [sans.length, activePly]);

  if (sans.length === 0) return <p className="px-1 py-4 text-center text-sm text-stone-500">No moves yet</p>;

  const rows: { n: number; w: string; b?: string }[] = [];
  for (let i = 0; i < sans.length; i += 2) rows.push({ n: i / 2 + 1, w: sans[i]!, b: sans[i + 1] });

  const cell = (san: string | undefined, ply: number) =>
    san ? (
      <button
        type="button"
        disabled={!onSelect}
        onClick={() => onSelect?.(ply)}
        className={cx('w-full rounded px-2 py-0.5 text-left font-mono text-sm', ply === active ? 'bg-green-100 font-semibold text-green-900' : 'text-stone-800', onSelect && 'hover:bg-stone-100')}
      >
        {san}
      </button>
    ) : null;

  return (
    <div ref={boxRef} className="max-h-72 overflow-y-auto overscroll-contain pr-1" aria-label="Move list">
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.n} className="odd:bg-stone-50">
              <td className="w-8 py-0.5 pl-1 text-xs text-stone-400 tabular-nums">{r.n}.</td>
              <td className="w-1/2">{cell(r.w, r.n * 2 - 1)}</td>
              <td className="w-1/2">{cell(r.b, r.n * 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
