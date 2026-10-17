import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/socket/socket';

/** Subscribes to a server event for the lifetime of the component. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const fn = (p: T) => ref.current(p);
    s.on(event, fn);
    return () => {
      s.off(event, fn);
    };
  }, [event]);
}

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(() => (getSocket().connected ? 'connected' : 'connecting'));
  useEffect(() => {
    const s = getSocket();
    const on = () => setStatus('connected');
    const off = () => setStatus('disconnected');
    const trying = () => setStatus('connecting');
    s.on('connect', on);
    s.on('disconnect', off);
    s.io.on('reconnect_attempt', trying);
    setStatus(s.connected ? 'connected' : s.active ? 'connecting' : 'disconnected');
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
      s.io.off('reconnect_attempt', trying);
    };
  }, []);
  return status;
}
