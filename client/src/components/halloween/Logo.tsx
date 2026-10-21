import { cx } from '../ui';

export const EVENT_NAME = "i++'26";
export const PRESENTER = 'ISTA';

/** Small event tag, e.g. in the top bar. */
export function EventBadge({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'rounded-md bg-[#2a1406] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#fdba74] ring-1 ring-orange-500/40',
        className,
      )}
    >
      {EVENT_NAME}
    </span>
  );
}

/**
 * Glowing jack-o'-lantern mark + spooky wordmark.
 * The large variant carries the full credit: "ISTA presents ChessArena for i++'26".
 */
export function Logo({ size = 'md', subtitle }: { size?: 'sm' | 'md' | 'lg'; subtitle?: string }) {
  const box = size === 'lg' ? 'size-11 text-2xl' : size === 'sm' ? 'size-8 text-lg' : 'size-9 text-xl';
  const text = size === 'lg' ? 'text-2xl' : 'text-xl';
  return (
    <span className="flex items-center gap-2">
      <span className={cx('flex shrink-0 items-center justify-center rounded-lg bg-[#2a1406] ring-1 ring-orange-500/40 animate-glow', box)} aria-hidden>
        🎃
      </span>
      <span className="leading-tight">
        {size === 'lg' && (
          <span className="block text-[11px] font-semibold uppercase tracking-[0.25em] text-stone-500">{PRESENTER} presents</span>
        )}
        <span className="flex items-center gap-2">
          <span className={cx('font-spooky block text-[#fdba74] [text-shadow:0_0_12px_rgba(249,115,22,0.45)]', text)}>ChessArena</span>
          {size !== 'lg' && <EventBadge className="hidden sm:inline" />}
        </span>
        {size === 'lg' && <span className="block text-xs text-stone-500">for {EVENT_NAME}</span>}
        {subtitle && <span className="block text-xs text-stone-500">{subtitle}</span>}
      </span>
    </span>
  );
}
