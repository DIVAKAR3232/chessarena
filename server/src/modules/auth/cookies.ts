import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env.js';
import { randomToken } from '../../lib/crypto.js';

export const ACCESS_COOKIE = 'ca_access';
export const REFRESH_COOKIE = 'ca_refresh';
export const CSRF_COOKIE = 'csrf_token';
export const REFRESH_PATH = '/api/v1/auth';

function base(): CookieOptions {
  return {
    secure: env.isProduction || env.COOKIE_SAMESITE === 'none',
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN,
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base(),
    httpOnly: true,
    path: '/',
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base(),
    httpOnly: true,
    path: REFRESH_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base(), httpOnly: true, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(), httpOnly: true, path: REFRESH_PATH });
}

/** Issues (or re-issues) the double-submit CSRF cookie. Readable by JS on purpose. */
export function setCsrfCookie(res: Response): string {
  const token = randomToken(24);
  res.cookie(CSRF_COOKIE, token, { ...base(), httpOnly: false, path: '/' });
  return token;
}
