import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

interface AccessClaims {
  sub: string;
  sid: string;
  typ: 'access';
}

interface SocketClaims {
  sub: string;
  sid: string;
  typ: 'socket';
}

const ISSUER = 'chessarena';

export function signAccessToken(userId: string, sessionId: string): string {
  const claims: AccessClaims = { sub: userId, sid: sessionId, typ: 'access' };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: ISSUER,
  });
}

export function verifyAccessToken(token: string): { userId: string; sessionId: string } | null {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
    }) as Partial<AccessClaims>;
    if (payload.typ !== 'access' || !payload.sub || !payload.sid) return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

/** Short-lived ticket used to authenticate the Socket.IO handshake (see docs/SECURITY.md). */
export function signSocketTicket(userId: string, sessionId: string): string {
  const claims: SocketClaims = { sub: userId, sid: sessionId, typ: 'socket' };
  return jwt.sign(claims, env.JWT_SOCKET_SECRET, {
    algorithm: 'HS256',
    expiresIn: 60,
    issuer: ISSUER,
  });
}

export function verifySocketTicket(token: string): { userId: string; sessionId: string } | null {
  try {
    const payload = jwt.verify(token, env.JWT_SOCKET_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
    }) as Partial<SocketClaims>;
    if (payload.typ !== 'socket' || !payload.sub || !payload.sid) return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}
