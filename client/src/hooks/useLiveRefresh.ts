import { useEffect, useRef } from 'react';
import { getSocket } from '../services/socket/socket';

/**
 * Keeps a view fresh: reloads when the server announces a change on any of `events`, when the tab
 * becomes visible again, and on a fallback interval (signed-out visitors have no socket).
 */
export function useLiveRefresh(reload: () => unknown, events: string[] = ['leaderboard:changed'], intervalMs = 30_000) {
  const ref = useRef(reload);
  ref.current = reload;

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    // Coalesce bursts (e.g. several results at once) into one reload.
    const trigger = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        void ref.current();
      }, 250);
    };
    const s = getSocket();
    for (const e of events) s.on(e, trigger);
    const onVisible = () => {
      if (document.visibilityState === 'visible') trigger();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', trigger);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') trigger();
    }, intervalMs);
    return () => {
      for (const e of events) s.off(e, trigger);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', trigger);
      clearInterval(timer);
      if (pending) clearTimeout(pending);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.join('|'), intervalMs]);
}
