// server/src/modules/health/health.service.ts — ping mongo + redis, trạng thái degraded/draining (kiến trúc §10)
import type { HealthResponse } from './health.schema';

export interface HealthDeps {
  pingMongo(): Promise<boolean>;
  isRedisHealthy(): boolean;
  isDraining(): boolean;
}

export interface HealthResult {
  httpStatus: 200 | 503;
  body: HealthResponse;
}

/** Mongo down hoặc draining → 503; chỉ Redis down → 200 degraded (chat vẫn chạy, §10.2). */
export async function getHealth(deps: HealthDeps): Promise<HealthResult> {
  const mongoUp = await deps.pingMongo();
  const redisUp = deps.isRedisHealthy();
  const mongo = mongoUp ? 'up' : 'down';
  const redis = redisUp ? 'up' : 'down';
  if (deps.isDraining()) return { httpStatus: 503, body: { status: 'draining', mongo, redis } };
  if (!mongoUp) return { httpStatus: 503, body: { status: 'degraded', mongo, redis } };
  return { httpStatus: 200, body: { status: redisUp ? 'ok' : 'degraded', mongo, redis } };
}
