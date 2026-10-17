import type { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthenticated } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { ACCESS_COOKIE } from '../modules/auth/cookies.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: Role;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
}

/**
 * Resolves a user from a verified session id. Returns null when the session is revoked/expired
 * or the account is not ACTIVE — used by both HTTP and Socket.IO authentication.
 */
export async function resolveSession(userId: string, sessionId: string): Promise<AuthContext | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      userId: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          email: true,
          role: true,
          accountStatus: true,
        },
      },
    },
  });
  if (!session || session.userId !== userId || session.revokedAt || session.expiresAt < new Date()) {
    return null;
  }
  if (session.user.accountStatus !== 'ACTIVE') return null;
  const { accountStatus: _status, ...user } = session.user;
  return { user, sessionId };
}

/** Populates req.auth when a valid access cookie is present. Never rejects by itself. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (token) {
    const claims = verifyAccessToken(token);
    if (claims) {
      const ctx = await resolveSession(claims.userId, claims.sessionId);
      if (ctx) req.auth = ctx;
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw unauthenticated();
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthenticated();
    if (!roles.includes(req.auth.user.role)) throw forbidden();
    next();
  };
}

/** Returns the authenticated context or throws 401. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
