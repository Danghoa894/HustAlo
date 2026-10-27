import { RATE_LIMITS } from '@hustalo/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../http/errors/app-error';
import { createRedis, type RedisHandle } from '../redis/redis';
import { createRateLimiters } from './rate-limiter';

describe('rate-limiter (Redis test DB)', () => {
  let redis: RedisHandle;

  beforeAll(async () => {
    redis = createRedis(process.env.REDIS_URL ?? '');
    await redis.client.connect();
  });

  beforeEach(async () => {
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await redis.close();
  });

  it('vượt points trong window → RATE_LIMITED kèm retryAfterSec', async () => {
    const limiters = createRateLimiters(redis.client);
    for (let i = 0; i < RATE_LIMITS.register.points; i += 1) await limiters.consume('register', '1.2.3.4');
    const err = await limiters.consume('register', '1.2.3.4').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('RATE_LIMITED');
    expect((err as AppError).retryAfterSec).toBeGreaterThanOrEqual(1);
    // subject khác không bị ảnh hưởng
    await expect(limiters.consume('register', '5.6.7.8')).resolves.toBeUndefined();
  });

  it('key Redis có tiền tố REDIS_KEY_PREFIX + rl:{rule}', async () => {
    await createRateLimiters(redis.client).consume('rest', 'u1');
    const keys = await redis.client.keys('*');
    expect(keys.some((k) => k.startsWith(`${process.env.REDIS_KEY_PREFIX ?? ''}rl:rest`))).toBe(true);
  });

  it('Redis mất kết nối: rule fail-closed → SERVICE_UNAVAILABLE; rule khác → limiter bộ nhớ (D-10)', async () => {
    const down = createRedis('redis://127.0.0.1:1/0'); // không có Redis ở cổng 1
    const limiters = createRateLimiters(down.client);
    const err = await limiters.consume('login', '1.2.3.4:a@b.c').catch((e: unknown) => e);
    expect((err as AppError).code).toBe('SERVICE_UNAVAILABLE');
    await expect(limiters.consume('rest', 'u1')).resolves.toBeUndefined();
    down.client.disconnect();
  });
});
