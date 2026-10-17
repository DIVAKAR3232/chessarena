import type { MatchListItem, MatchResult, MatchStatus } from '../types/api';

export function formatTimeControl(initialMs: number, incrementMs: number): string {
  const min = initialMs / 60_000;
  return `${Number.isInteger(min) ? min : min.toFixed(1)}+${Math.round(incrementMs / 1000)}`;
}

export function timeControlCategory(initialMs: number, incrementMs: number): string {
  const estimate = initialMs / 1000 + (40 * incrementMs) / 1000;
  if (estimate < 180) return 'Bullet';
  if (estimate < 480) return 'Blitz';
  if (estimate < 1500) return 'Rapid';
  return 'Classical';
}

/** Clock display: m:ss, with tenths under 10 seconds. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) return `0:0${(clamped / 1000).toFixed(1)}`;
  const total = Math.ceil(clamped / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export const resultToken = (r: MatchResult | null) =>
  r === 'WHITE_WIN' ? '1–0' : r === 'BLACK_WIN' ? '0–1' : r === 'DRAW' ? '½–½' : r === 'NO_RESULT' ? '—' : '';

export const humanize = (s: string | null | undefined) =>
  s ? s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '';

export const statusTone = (s: MatchStatus): 'green' | 'gray' | 'amber' | 'red' | 'blue' =>
  s === 'IN_PROGRESS' ? 'green' : s === 'READY' || s === 'WAITING' || s === 'CREATED' ? 'blue' : s === 'DISPUTED' ? 'amber' : s === 'CANCELLED' || s === 'ABANDONED' ? 'red' : 'gray';

/** Outcome of a finished match from one player's perspective. */
export function outcomeFor(m: Pick<MatchListItem, 'result' | 'winnerId'>, userId: string): 'win' | 'loss' | 'draw' | 'none' {
  if (m.result === 'DRAW') return 'draw';
  if (!m.result || m.result === 'NO_RESULT') return 'none';
  return m.winnerId === userId ? 'win' : 'loss';
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
