import { cx } from '../ui';

/** Glowing jack-o'-lantern mark + spooky wordmark. */
export function Logo({ size = 'md', subtitle }: { size?: 'sm' | 'md' | 'lg'; subtitle?: string }) {
  const box = size === 'lg' ? 'size-11 text-2xl' : size === 'sm' ? 'size-8 text-lg' : 'size-9 text-xl';
  const text = size === 'lg' ? 'text-2xl' : 'text-xl';
  return (
    <span className="flex items-center gap-2">
      <span className={cx('flex items-center justify-center rounded-lg bg-[#2a1406] ring-1 ring-orange-500/40 animate-glow', box)} aria-hidden>
        🎃
      </span>
      <span className="leading-tight">
        <span className={cx('font-spooky block text-[#fdba74] [text-shadow:0_0_12px_rgba(249,115,22,0.45)]', text)}>ChessArena</span>
        {subtitle && <span className="block text-xs text-stone-500">{subtitle}</span>}
      </span>
    </span>
  );
}
