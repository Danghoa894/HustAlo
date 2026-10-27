// server/src/http/middleware/rate-limit.ts — middleware theo rule RATE_LIMITS (FR-SEC-005, D-10)
import { createHash } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { RateLimiters, RateRule } from '../../infra/rate-limit/rate-limiter';
import { getAuth } from './authenticate';

export type SubjectFn = (req: Request, res: Response) => string;

/** Subject chuẩn theo cột `key` của RATE_LIMITS. */
export const subjects = {
  ip: (req: Request) => req.ip ?? 'unknown',
  user: (_req: Request, res: Response) => getAuth(res).userId,
  /** login: ip + hash email (không đưa email thô vào key Redis, kiến trúc §7(a)). */
  ipEmail: (req: Request, res: Response) => {
    const body = (res.locals as { valid?: { body?: { email?: string } } }).valid?.body;
    const email = body?.email ?? '';
    return `${req.ip ?? 'unknown'}:${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
  },
} satisfies Record<string, SubjectFn>;

export function rateLimit(limiters: RateLimiters, rule: RateRule, subject: SubjectFn): RequestHandler {
  return (req, res, next) => {
    limiters.consume(rule, subject(req, res)).then(() => {
      next();
    }, next);
  };
}
