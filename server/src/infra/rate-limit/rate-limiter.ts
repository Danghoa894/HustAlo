// server/src/infra/rate-limit/rate-limiter.ts — factory theo RATE_LIMITS (kiến trúc §4.4.1, §10.2, D-10)
// login/register/refresh/changePassword: fail-closed khi Redis lỗi → SERVICE_UNAVAILABLE.
// Rule khác: fail-open có kiểm soát bằng insuranceLimiter bộ nhớ cùng hạn mức (per-instance).
import { RATE_LIMITS } from '@hustalo/shared';
import type { Redis } from 'ioredis';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { AppError } from '../../http/errors/app-error';
import { metrics } from '../metrics/metrics';
import { keys } from '../redis/keys';

export type RateRule = keyof typeof RATE_LIMITS;

export const FAIL_CLOSED_RULES: ReadonlySet<RateRule> = new Set(['login', 'register', 'refresh', 'changePassword']);

export interface RateLimiters {
  consume(rule: RateRule, subject: string): Promise<void>;
}

export function createRateLimiters(redis: Redis): RateLimiters {
  const limiters = new Map<RateRule, RateLimiterRedis>();
  for (const rule of Object.keys(RATE_LIMITS) as RateRule[]) {
    const { points, windowSec } = RATE_LIMITS[rule];
    limiters.set(
      rule,
      new RateLimiterRedis({
        storeClient: redis,
        keyPrefix: keys.rateLimitPrefix(rule),
        points,
        duration: windowSec,
        // Xác minh với tài liệu chính thức của rate-limiter-flexible: tùy chọn insuranceLimiter của RateLimiterRedis.
        ...(FAIL_CLOSED_RULES.has(rule)
          ? {}
          : { insuranceLimiter: new RateLimiterMemory({ keyPrefix: `mem:${rule}`, points, duration: windowSec }) }),
      }),
    );
  }

  return {
    async consume(rule, subject) {
      const limiter = limiters.get(rule);
      if (!limiter) throw new Error(`Rule rate limit không tồn tại: ${rule}`);
      try {
        await limiter.consume(subject);
      } catch (err) {
        if (err instanceof RateLimiterRes) {
          metrics.rateLimited.inc({ rule });
          const retryAfterSec = Math.max(1, Math.ceil(err.msBeforeNext / 1000));
          throw new AppError(
            'RATE_LIMITED',
            'Bạn thao tác quá nhanh, vui lòng thử lại sau',
            undefined,
            undefined,
            retryAfterSec,
          );
        }
        // Lỗi Redis trên rule fail-closed (rule khác đã được insuranceLimiter xử lý).
        throw new AppError('SERVICE_UNAVAILABLE', 'Dịch vụ tạm thời không khả dụng, vui lòng thử lại');
      }
    },
  };
}
