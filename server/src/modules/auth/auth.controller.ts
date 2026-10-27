// server/src/modules/auth/auth.controller.ts — đọc request, gọi service, set/xóa cookie (kiến trúc §6.3)
import {
  CSRF_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_S,
} from '@hustalo/shared';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { env } from '../../config/env';
import { getAuth } from '../../http/middleware/authenticate';
import type { AuthService, IssuedSession, RequestMeta } from './auth.service';
import type { ChangePasswordRequest, LoginRequest, RegisterRequest } from './auth.schema';

const base = (): CookieOptions => ({ secure: env.COOKIE_SECURE, sameSite: 'strict' });
const refreshCookie = (): CookieOptions => ({
  ...base(),
  httpOnly: true,
  path: REFRESH_COOKIE_PATH,
  maxAge: REFRESH_TOKEN_TTL_S * 1000,
});
const csrfCookie = (): CookieOptions => ({ ...base(), httpOnly: false, path: '/', maxAge: REFRESH_TOKEN_TTL_S * 1000 });

const meta = (req: Request): RequestMeta => ({ ip: req.ip ?? '', userAgent: req.get('user-agent') ?? '' });
const body = <T>(res: Response) => (res.locals as { valid: { body: T } }).valid.body;
const refreshTokenOf = (req: Request) => (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE_NAME];

function setSessionCookies(res: Response, issued: IssuedSession): void {
  res.cookie(REFRESH_COOKIE_NAME, issued.refreshToken, refreshCookie());
  if (issued.csrfToken) res.cookie(CSRF_COOKIE_NAME, issued.csrfToken, csrfCookie());
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookie(), maxAge: undefined });
  res.clearCookie(CSRF_COOKIE_NAME, { ...csrfCookie(), maxAge: undefined });
}

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export function authController(service: AuthService) {
  return {
    register: handle(async (req, res) => {
      const issued = await service.register(body<RegisterRequest>(res), meta(req));
      setSessionCookies(res, issued);
      res.status(201).json(issued.body);
    }),

    login: handle(async (req, res) => {
      const issued = await service.login(body<LoginRequest>(res), meta(req));
      setSessionCookies(res, issued);
      res.status(200).json(issued.body);
    }),

    refresh: handle(async (req, res) => {
      try {
        const issued = await service.refresh(refreshTokenOf(req), meta(req));
        setSessionCookies(res, issued);
        res.status(200).json(issued.body);
      } catch (err) {
        // 401 (không hợp lệ / reuse) → xóa cookie; 409 grace giữ nguyên cookie để tab retry.
        if ((err as { code?: string }).code === 'UNAUTHENTICATED') clearSessionCookies(res);
        throw err;
      }
    }),

    logout: handle(async (req, res) => {
      await service.logout(refreshTokenOf(req));
      clearSessionCookies(res);
      res.status(204).end();
    }),

    me: handle(async (_req, res) => {
      res.status(200).json(await service.getMe(getAuth(res).userId));
    }),

    changePassword: handle(async (_req, res) => {
      await service.changePassword(getAuth(res), body<ChangePasswordRequest>(res));
      res.status(204).end();
    }),
  };
}
