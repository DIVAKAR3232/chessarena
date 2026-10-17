import { Router, type Request } from 'express';
import { getAuth, requireAuth } from '../../middleware/auth.js';
import { authLimiter, sensitiveLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../lib/validate.js';
import { prisma } from '../../lib/prisma.js';
import { privateUserSelect } from '../users/user.mapper.js';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.schemas.js';
import * as auth from './auth.service.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies, setCsrfCookie } from './cookies.js';
import { signSocketTicket } from './tokens.js';

const clientInfo = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

export const authRouter = Router();

/** Issues a fresh CSRF cookie and returns its value. Called by the SPA on start-up. */
authRouter.get('/csrf', (_req, res) => {
  const token = setCsrfCookie(res);
  res.json({ data: { csrfToken: token } });
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const input = validate(registerSchema, req.body);
  const { user, session, verificationRequired } = await auth.register(input, clientInfo(req));
  if (session) setAuthCookies(res, session.accessToken, session.refreshToken);
  res.status(201).json({ data: { user, verificationRequired } });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const input = validate(loginSchema, req.body);
  const { user, session } = await auth.login(input, clientInfo(req));
  setAuthCookies(res, session.accessToken, session.refreshToken);
  setCsrfCookie(res); // rotate CSRF token on privilege change
  res.json({ data: { user } });
});

authRouter.post('/refresh', async (req, res) => {
  try {
    const session = await auth.refresh(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    setAuthCookies(res, session.accessToken, session.refreshToken);
    res.json({ data: { ok: true } });
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
});

authRouter.post('/logout', async (req, res) => {
  if (req.auth) await auth.logout(req.auth.sessionId);
  clearAuthCookies(res);
  res.json({ data: { ok: true } });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { user } = getAuth(req);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: privateUserSelect });
  res.json({ data: { user: me } });
});

authRouter.post('/socket-ticket', requireAuth, (req, res) => {
  const { user, sessionId } = getAuth(req);
  res.json({ data: { ticket: signSocketTicket(user.id, sessionId) } });
});

authRouter.post('/forgot-password', sensitiveLimiter, async (req, res) => {
  const { email } = validate(forgotPasswordSchema, req.body);
  await auth.forgotPassword(email);
  res.json({ data: { ok: true, message: 'If an account exists for that email, a reset link has been sent.' } });
});

authRouter.post('/reset-password', sensitiveLimiter, async (req, res) => {
  const { token, password } = validate(resetPasswordSchema, req.body);
  await auth.resetPassword(token, password);
  clearAuthCookies(res);
  res.json({ data: { ok: true } });
});

authRouter.post('/verify-email', sensitiveLimiter, async (req, res) => {
  const { token } = validate(verifyEmailSchema, req.body);
  await auth.verifyEmail(token);
  res.json({ data: { ok: true } });
});

authRouter.post('/resend-verification', sensitiveLimiter, async (req, res) => {
  const { email } = validate(forgotPasswordSchema, req.body);
  await auth.resendVerification(email);
  res.json({ data: { ok: true } });
});
