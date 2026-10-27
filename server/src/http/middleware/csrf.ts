// server/src/http/middleware/csrf.ts — double-submit cho /auth/refresh, /auth/logout (AUTHZ-8, kiến trúc §6.3, FR-SEC-006)
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@hustalo/shared';
import type { RequestHandler } from 'express';
import { timingSafeEqual } from '../../infra/crypto/random';
import { AppError } from '../errors/app-error';

export const csrf: RequestHandler = (req, _res, next) => {
  const cookie = (req.cookies as Record<string, string | undefined>)[CSRF_COOKIE_NAME];
  const header = req.get(CSRF_HEADER_NAME);
  if (!cookie || !header || !timingSafeEqual(cookie, header)) {
    next(new AppError('FORBIDDEN', 'Yêu cầu không hợp lệ'));
    return;
  }
  next();
};
