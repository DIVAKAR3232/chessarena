import type { NextFunction, Request, Response } from 'express';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { CSRF_COOKIE } from '../modules/auth/cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit cookie check for every state-changing request. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.get('x-csrf-token');
  if (!cookie || !header || !safeEqual(cookie, header)) {
    throw new AppError('CSRF_INVALID', 'Missing or invalid CSRF token');
  }
  next();
}
