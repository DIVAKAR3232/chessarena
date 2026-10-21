import { useEffect, useRef, useState } from 'react';
import { cx } from '../../components/ui';
import { formatClock } from '../../utils/format';

/**
 * Display-only countdown. The server owns the clock; this interpolates from the last
 * authoritative value using the local monotonic clock until the next update arrives.
 */
export function Clock({ ms, running, receivedAt }: { ms: number; running: boolean; receivedAt: number }) {
  const [now, setNow] = useState(() => performance.now());
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      setNow(performance.now());
      raf.current = window.setTimeout(tick, 100);
    };
    tick();
    return () => {
      if (raf.current) clearTimeout(raf.current);
    };
  }, [running, receivedAt]);

  const remaining = running ? Math.max(0, ms - (now - receivedAt)) : ms;
  const low = remaining < 20_000;
  return (
    <div
      role="timer"
      aria-live="off"
      className={cx(
        'min-w-24 rounded-lg px-3 py-1.5 text-right font-mono text-xl font-semibold tabular-nums transition-colors',
        running ? (low ? 'animate-pulse bg-red-700 text-white' : 'bg-green-800 text-white shadow-[0_0_16px_rgba(249,115,22,0.55)]') : 'bg-stone-100 text-stone-500',
      )}
    >
      {formatClock(remaining)}
    </div>
  );
}
