import { io, type Socket } from 'socket.io-client';
import { post } from '../api/client';

/**
 * Socket.IO connects directly to the API host (Vercel cannot proxy WebSockets). It authenticates
 * with a 60-second ticket fetched over the cookie-authenticated REST API; the `auth` callback runs
 * on every (re)connection so an expired session cannot reconnect.
 */
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) || undefined;

let socket: Socket | null = null;

export type AckResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export function getSocket(): Socket {
  if (socket) return socket;
  const s = io(SOCKET_URL ?? '/', {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    auth: (cb) => {
      post<{ ticket: string }>('/auth/socket-ticket')
        .then(({ ticket }) => cb({ ticket }))
        .catch(() => cb({}));
    },
  });
  socket = s;
  return s;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Emits with an acknowledgement and a timeout. */
export function emitAck<T = unknown>(event: string, payload: unknown, timeoutMs = 10_000): Promise<AckResponse<T>> {
  const s = getSocket();
  return new Promise((resolve) => {
    s.timeout(timeoutMs).emit(event, payload, (err: Error | null, res: AckResponse<T>) => {
      if (err) resolve({ ok: false, error: { code: 'TIMEOUT', message: 'The server did not respond in time' } });
      else resolve(res);
    });
  });
}
