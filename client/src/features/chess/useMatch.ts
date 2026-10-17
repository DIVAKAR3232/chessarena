import { useCallback, useEffect, useRef, useState } from 'react';
import { emitAck, getSocket } from '../../services/socket/socket';
import type { MatchState } from '../../types/api';

interface OpponentPresence {
  connected: boolean;
  graceUntil: number | null;
}

/**
 * Keeps a match in sync with the server over Socket.IO. The server state is authoritative; every
 * event carries the full state, and the hook re-joins (and resyncs) after every reconnect.
 */
export function useMatch(matchId: string) {
  const [state, setState] = useState<MatchState | null>(null);
  const [receivedAt, setReceivedAt] = useState(() => performance.now());
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'player' | 'spectator' | null>(null);
  const [presence, setPresence] = useState<Record<string, OpponentPresence>>({});
  const [lastEvent, setLastEvent] = useState<{ type: string; at: number; payload?: unknown } | null>(null);
  const versionRef = useRef(-1);

  const apply = useCallback(
    (next: MatchState | undefined) => {
      if (!next || next.id !== matchId) return;
      // Ignore out-of-order events carrying an older position.
      if (next.version < versionRef.current) return;
      versionRef.current = next.version;
      setState(next);
      setReceivedAt(performance.now());
      setPresence((p) => ({
        ...p,
        ...(next.white ? { [next.white.id]: { connected: next.whiteConnected, graceUntil: next.whiteConnected ? null : p[next.white.id]?.graceUntil ?? null } } : {}),
        ...(next.black ? { [next.black.id]: { connected: next.blackConnected, graceUntil: next.blackConnected ? null : p[next.black.id]?.graceUntil ?? null } } : {}),
      }));
    },
    [matchId],
  );

  const join = useCallback(async () => {
    const res = await emitAck<{ state: MatchState; role: 'player' | 'spectator' }>('match:join', { matchId });
    if (res.ok) {
      setError(null);
      versionRef.current = -1;
      apply(res.data.state);
      setRole(res.data.role);
    } else {
      setError(res.error.message);
    }
  }, [apply, matchId]);

  useEffect(() => {
    const s = getSocket();
    const onState = (p: { state: MatchState }) => apply(p.state);
    const onMove = (p: { state: MatchState; move: unknown }) => {
      apply(p.state);
      setLastEvent({ type: 'move', at: Date.now(), payload: p.move });
    };
    const onResult = (p: { state: MatchState }) => {
      apply(p.state);
      setLastEvent({ type: 'result', at: Date.now() });
    };
    const onDrawOffered = (p: { matchId: string }) => {
      if (p.matchId === matchId) setLastEvent({ type: 'draw-offered', at: Date.now(), payload: p });
    };
    const onDrawDeclined = (p: { matchId: string }) => {
      if (p.matchId === matchId) setLastEvent({ type: 'draw-declined', at: Date.now(), payload: p });
    };
    const onOppConnected = (p: { matchId: string; userId: string }) => {
      if (p.matchId !== matchId) return;
      setPresence((prev) => ({ ...prev, [p.userId]: { connected: true, graceUntil: null } }));
    };
    const onOppDisconnected = (p: { matchId: string; userId: string; graceMs: number | null }) => {
      if (p.matchId !== matchId) return;
      setPresence((prev) => ({ ...prev, [p.userId]: { connected: false, graceUntil: p.graceMs ? Date.now() + p.graceMs : null } }));
    };
    const onConnect = () => void join();

    s.on('match:state', onState);
    s.on('match:move:accepted', onMove);
    s.on('match:result', onResult);
    s.on('match:draw:offered', onDrawOffered);
    s.on('match:draw:declined', onDrawDeclined);
    s.on('match:opponent:connected', onOppConnected);
    s.on('match:opponent:disconnected', onOppDisconnected);
    s.on('connect', onConnect);
    if (s.connected) void join();
    else s.connect();

    return () => {
      s.off('match:state', onState);
      s.off('match:move:accepted', onMove);
      s.off('match:result', onResult);
      s.off('match:draw:offered', onDrawOffered);
      s.off('match:draw:declined', onDrawDeclined);
      s.off('match:opponent:connected', onOppConnected);
      s.off('match:opponent:disconnected', onOppDisconnected);
      s.off('connect', onConnect);
      if (s.connected) s.emit('match:leave', { matchId });
    };
  }, [apply, join, matchId]);

  const resync = useCallback(async () => {
    const res = await emitAck<{ state: MatchState }>('match:sync:request', { matchId });
    if (res.ok) {
      versionRef.current = -1;
      apply(res.data.state);
    }
  }, [apply, matchId]);

  const move = useCallback(
    async (from: string, to: string, promotion?: string) => {
      if (!state) return { ok: false as const, message: 'Not loaded' };
      const res = await emitAck('match:move', { matchId, from, to, promotion: promotion ?? null, version: state.version });
      if (res.ok) return { ok: true as const };
      if (res.error.code === 'STALE_POSITION') void resync();
      return { ok: false as const, message: res.error.message };
    },
    [matchId, resync, state],
  );

  const action = useCallback(
    async (event: string, extra: Record<string, unknown> = {}) => {
      const res = await emitAck(event, { matchId, ...extra });
      return res.ok ? { ok: true as const } : { ok: false as const, message: res.error.message };
    },
    [matchId],
  );

  return {
    state,
    receivedAt,
    error,
    role,
    presence,
    lastEvent,
    move,
    resync,
    resign: () => action('match:resign'),
    offerDraw: () => action('match:draw:offer'),
    respondDraw: (accept: boolean) => action('match:draw:respond', { accept }),
    claimDraw: () => action('match:draw:claim'),
  };
}
