// server/src/modules/auth/auth.routes.ts — /auth/register, login, refresh, logout, me, change-password
import { Router } from 'express';
import { authenticate } from '../../http/middleware/authenticate';
import { csrf } from '../../http/middleware/csrf';
import { rateLimit, subjects } from '../../http/middleware/rate-limit';
import { validate } from '../../http/middleware/validate';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import { authController } from './auth.controller';
import { ChangePasswordRequestSchema, LoginRequestSchema, RegisterRequestSchema } from './auth.schema';
import type { AuthService } from './auth.service';

export function authRoutes(service: AuthService, limiters: RateLimiters): Router {
  const c = authController(service);
  const router = Router();
  router.post(
    '/auth/register',
    rateLimit(limiters, 'register', subjects.ip),
    validate({ body: RegisterRequestSchema }),
    c.register,
  );
  router.post(
    '/auth/login',
    validate({ body: LoginRequestSchema }),
    rateLimit(limiters, 'login', subjects.ipEmail),
    c.login,
  );
  router.post('/auth/refresh', rateLimit(limiters, 'refresh', subjects.ip), csrf, c.refresh);
  router.post('/auth/logout', rateLimit(limiters, 'refresh', subjects.ip), csrf, c.logout);
  router.get('/auth/me', authenticate(service), rateLimit(limiters, 'rest', subjects.user), c.me);
  router.post(
    '/auth/change-password',
    authenticate(service),
    // Tính cả lần đúng và sai (FR-AUTH-005) → đặt trước validate/verify.
    rateLimit(limiters, 'changePassword', subjects.user),
    validate({ body: ChangePasswordRequestSchema }),
    c.changePassword,
  );
  return router;
}
