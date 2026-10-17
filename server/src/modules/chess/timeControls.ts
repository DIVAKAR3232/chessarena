export interface TimeControl {
  initialTimeMs: number;
  incrementMs: number;
}

export interface TimeControlPreset extends TimeControl {
  id: string;
  label: string;
  category: 'bullet' | 'blitz' | 'rapid';
}

const min = (m: number) => m * 60_000;
const sec = (s: number) => s * 1000;

export const TIME_CONTROL_PRESETS: readonly TimeControlPreset[] = [
  { id: '1+0', label: '1+0', category: 'bullet', initialTimeMs: min(1), incrementMs: 0 },
  { id: '2+1', label: '2+1', category: 'bullet', initialTimeMs: min(2), incrementMs: sec(1) },
  { id: '3+0', label: '3+0', category: 'blitz', initialTimeMs: min(3), incrementMs: 0 },
  { id: '3+2', label: '3+2', category: 'blitz', initialTimeMs: min(3), incrementMs: sec(2) },
  { id: '5+0', label: '5+0', category: 'blitz', initialTimeMs: min(5), incrementMs: 0 },
  { id: '5+3', label: '5+3', category: 'blitz', initialTimeMs: min(5), incrementMs: sec(3) },
  { id: '10+0', label: '10+0', category: 'rapid', initialTimeMs: min(10), incrementMs: 0 },
  { id: '10+5', label: '10+5', category: 'rapid', initialTimeMs: min(10), incrementMs: sec(5) },
  { id: '15+10', label: '15+10', category: 'rapid', initialTimeMs: min(15), incrementMs: sec(10) },
];

export function isPreset(tc: TimeControl): boolean {
  return TIME_CONTROL_PRESETS.some(
    (p) => p.initialTimeMs === tc.initialTimeMs && p.incrementMs === tc.incrementMs,
  );
}

export interface CustomLimits {
  customMinInitialMs: number;
  customMaxInitialMs: number;
  customMaxIncrementMs: number;
}

/** A time control is allowed if it is a preset or falls within the admin-defined custom limits. */
export function isAllowedTimeControl(tc: TimeControl, limits: CustomLimits): boolean {
  if (isPreset(tc)) return true;
  return (
    tc.initialTimeMs >= limits.customMinInitialMs &&
    tc.initialTimeMs <= limits.customMaxInitialMs &&
    tc.incrementMs >= 0 &&
    tc.incrementMs <= limits.customMaxIncrementMs
  );
}

export const formatTimeControl = (tc: TimeControl) =>
  `${Math.round((tc.initialTimeMs / 60_000) * 100) / 100}+${Math.round(tc.incrementMs / 1000)}`;
