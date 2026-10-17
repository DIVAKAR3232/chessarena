import { Search, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { getPaged } from '../services/api/client';
import type { PublicUser } from '../types/api';

interface Props {
  label: string;
  value: PublicUser | null;
  onChange: (u: PublicUser | null) => void;
  excludeIds?: string[];
  /** Optional custom search endpoint returning PublicUser-like rows. */
  endpoint?: string;
}

/** Debounced player search (server-side) used for invitations and participant management. */
export function PlayerPicker({ label, value, onChange, excludeIds = [], endpoint = '/players' }: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      getPaged<PublicUser>(endpoint, { search: query || undefined, pageSize: 8 })
        .then((r) => setResults(r.data.filter((u) => !excludeIds.includes(u.id))))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, endpoint]);

  if (value) {
    return (
      <div>
        <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
        <div className="flex items-center justify-between rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
          <span>
            {value.displayName} <span className="text-stone-500">@{value.username}</span>
            {value.profile && <span className="ml-1 text-stone-500">· {value.profile.rating}</span>}
          </span>
          <button type="button" onClick={() => onChange(null)} className="text-stone-400 hover:text-stone-700" aria-label="Clear selection">
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-stone-700">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-stone-400" aria-hidden />
        <input
          id={id}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search by name or username"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          className="block w-full rounded-lg border border-stone-300 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-green-700 focus:ring-2 focus:ring-green-100"
        />
      </div>
      {open && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-stone-500">No players found</li>
          ) : (
            results.map((u) => (
              <li key={u.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(u);
                    setQuery('');
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-stone-50"
                >
                  <span>
                    {u.displayName} <span className="text-stone-500">@{u.username}</span>
                  </span>
                  {u.profile && <span className="text-xs text-stone-500 tabular-nums">{u.profile.rating}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
