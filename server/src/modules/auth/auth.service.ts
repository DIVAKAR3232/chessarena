import type { TokenPurpose } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError, conflict, forbidden, unauthenticated } from '../../lib/errors.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { emailConfigured, sendMail } from '../../services/mail.js';
import { audit } from '../audit/audit.service.js';
import { getSettings } from '../settings/settings.service.js';
import { privateUserSelect } from '../users/user.mapper.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js';
import { signAccessToken } from './tokens.js';

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
}

export async function createSession(userId: string, client: ClientInfo, tx: Tx = prisma): Promise<IssuedSession> {
  const refreshToken = randomToken(32);
  const session = await tx.session.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      ip: client.ip?.slice(0, 64),
      userAgent: client.userAgent?.slice(0, 256),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return { sessionId: session.id, accessToken: signAccessToken(userId, session.id), refreshToken };
}

export async function register(
  input: { displayName: string; username: string; email: string; password: string },
  client: ClientInfo,
) {
  const settings = await getSettings();
  if (!settings.registrationOpen) throw forbidden('Registration is currently closed');

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { username: input.username }] },
    select: { email: true, username: true },
  });
  if (existing) {
    const field = existing.email === input.email ? 'email' : 'username';
    throw conflict(`This ${field} is already registered`, [{ path: field, message: `${field} already in use` }]);
  }

  const passwordHash = await hashPassword(input.password);
  const verificationRequired = emailConfigured();

  // Role is never taken from input: every self-registered account is a PLAYER.
  const { user, session } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: input.username,
        displayName: input.displayName,
        email: input.email,
        passwordHash,
        role: 'PLAYER',
        profile: { create: {} },
      },
      select: privateUserSelect,
    });
    await audit({ actorId: user.id, action: 'auth.register', resourceType: 'user', resourceId: user.id }, tx);
    const session = verificationRequired ? null : await createSession(user.id, client, tx);
    if (session) await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { user, session };
  });

  if (verificationRequired) await sendVerificationEmail(user.id, user.email);
  return { user, session, verificationRequired };
}

export async function login(
  input: { identifier: string; password: string; portal?: 'app' | 'admin' },
  client: ClientInfo,
) {
  const identifier = input.identifier.toLowerCase();
  const user = await prisma.user.findFirst({
    where: identifier.includes('@') ? { email: identifier } : { username: identifier },
    select: { id: true, passwordHash: true, accountStatus: true, emailVerifiedAt: true, role: true },
  });

  // Always run bcrypt so response time does not reveal whether the account exists.
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  // The admin portal accepts administrators only; for anyone else it behaves exactly like a
  // wrong password, so it does not reveal which accounts exist.
  if (!user || !ok || (input.portal === 'admin' && user.role !== 'ADMIN')) {
    logger.warn({ ip: client.ip, portal: input.portal ?? 'app' }, 'Failed login attempt');
    throw new AppError('UNAUTHENTICATED', 'Invalid credentials');
  }
  if (input.portal !== 'admin' && user.role === 'ADMIN') {
    throw forbidden('Administrator accounts sign in through the admin portal at /admin/login.');
  }
  if (user.accountStatus !== 'ACTIVE') {
    logger.warn({ userId: user.id }, 'Login attempt on inactive account');
    throw forbidden('This account is not active. Contact an administrator.');
  }
  if (emailConfigured() && !user.emailVerifiedAt) {
    throw forbidden('Please verify your email address before signing in.');
  }

  const session = await prisma.$transaction(async (tx) => {
    const s = await createSession(user.id, client, tx);
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return s;
  });
  const profile = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: privateUserSelect });
  return { user: profile, session };
}

/** Rotates the refresh token. The old token stops working immediately. */
export async function refresh(refreshToken: string | undefined) {
  if (!refreshToken) throw unauthenticated();
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: sha256(refreshToken) },
    include: { user: { select: { accountStatus: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.accountStatus !== 'ACTIVE') {
    throw unauthenticated('Session expired');
  }
  const newRefresh = randomToken(32);
  // Conditional update guards against two concurrent refreshes using the same token.
  const updated = await prisma.session.updateMany({
    where: { id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
    data: { refreshTokenHash: sha256(newRefresh), lastUsedAt: new Date() },
  });
  if (updated.count !== 1) throw unauthenticated('Session expired');
  return {
    sessionId: session.id,
    accessToken: signAccessToken(session.userId, session.id),
    refreshToken: newRefresh,
  };
}

export async function logout(sessionId: string) {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string, tx: Tx = prisma, exceptSessionId?: string) {
  await tx.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

async function issueToken(userId: string, purpose: TokenPurpose, ttlMs: number, initiatedById?: string) {
  const token = randomToken(32);
  await prisma.$transaction([
    // Only the newest token of each purpose is valid.
    prisma.passwordResetToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs), initiatedById },
    }),
  ]);
  return token;
}

/** Always resolves (no account enumeration). */
export async function forgotPassword(email: string, initiatedById?: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, accountStatus: true } });
  if (!user || user.accountStatus === 'DISABLED') return;
  const token = await issueToken(user.id, 'RESET_PASSWORD', RESET_TOKEN_TTL_MS, initiatedById);
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: 'Reset your ChessArena password',
    text: `A password reset was requested for your ChessArena account.\n\nOpen this link within 30 minutes to choose a new password:\n${link}\n\nIf you did not request this, you can ignore this email.`,
    devLink: link,
  });
}

export async function resetPassword(token: string, password: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.purpose !== 'RESET_PASSWORD' || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError('BAD_REQUEST', 'This reset link is invalid or has expired');
  }
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    // Single use: claim the token atomically.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AppError('BAD_REQUEST', 'This reset link is invalid or has expired');
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await revokeAllSessions(record.userId, tx);
    await audit({ actorId: record.userId, action: 'auth.password_reset', resourceType: 'user', resourceId: record.userId }, tx);
  });
}

export async function sendVerificationEmail(userId: string, email: string) {
  const token = await issueToken(userId, 'VERIFY_EMAIL', VERIFY_TOKEN_TTL_MS);
  const link = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: email,
    subject: 'Verify your ChessArena email address',
    text: `Welcome to ChessArena!\n\nConfirm your email address by opening this link within 24 hours:\n${link}`,
    devLink: link,
  });
}

export async function resendVerification(email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, emailVerifiedAt: true } });
  if (!user || user.emailVerifiedAt) return;
  await sendVerificationEmail(user.id, user.email);
}

export async function verifyEmail(token: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.purpose !== 'VERIFY_EMAIL' || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError('BAD_REQUEST', 'This verification link is invalid or has expired');
  }
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
}

export async function changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError('VALIDATION_ERROR', 'Current password is incorrect', [
      { path: 'currentPassword', message: 'Current password is incorrect' },
    ]);
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    // Sign out every other device.
    await revokeAllSessions(userId, tx, sessionId);
    await audit({ actorId: userId, action: 'auth.password_change', resourceType: 'user', resourceId: userId }, tx);
  });
}
