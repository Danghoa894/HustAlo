import { describe, expect, it } from 'vitest';
import { getHealth, type HealthDeps } from './health.service';

const deps = (mongo: boolean, redis: boolean, draining = false): HealthDeps => ({
  pingMongo: () => Promise.resolve(mongo),
  isRedisHealthy: () => redis,
  isDraining: () => draining,
});

describe('health.service', () => {
  it('mọi phụ thuộc up → 200 ok', async () => {
    expect(await getHealth(deps(true, true))).toEqual({
      httpStatus: 200,
      body: { status: 'ok', mongo: 'up', redis: 'up' },
    });
  });

  it('Redis down → 200 degraded (kiến trúc §10.2)', async () => {
    expect(await getHealth(deps(true, false))).toEqual({
      httpStatus: 200,
      body: { status: 'degraded', mongo: 'up', redis: 'down' },
    });
  });

  it('Mongo down → 503 degraded (kiến trúc §10.1)', async () => {
    expect(await getHealth(deps(false, true))).toEqual({
      httpStatus: 503,
      body: { status: 'degraded', mongo: 'down', redis: 'up' },
    });
  });

  it('đang draining → 503 draining (kiến trúc §10.3)', async () => {
    expect((await getHealth(deps(true, true, true))).body.status).toBe('draining');
    expect((await getHealth(deps(true, true, true))).httpStatus).toBe(503);
  });
});
