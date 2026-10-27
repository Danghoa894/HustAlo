import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createLogger } from './infra/logger/logger';
import type { ErrorResponse, HealthResponse } from '@hustalo/shared';
import type { HealthDeps } from './modules/health/health.service';

const errorBody = (res: { body: unknown }) => (res.body as ErrorResponse).error;
const healthBody = (res: { body: unknown }) => res.body as HealthResponse;

const allowed = 'https://localhost:5173';

function makeApp(health: Partial<HealthDeps> = {}) {
  return createApp({
    logger: createLogger({ level: 'silent' }),
    corsOrigins: [allowed],
    trustProxy: 1,
    production: false,
    health: {
      pingMongo: () => Promise.resolve(true),
      isRedisHealthy: () => true,
      isDraining: () => false,
      ...health,
    },
  });
}

describe('HTTP security (AC-107, kiến trúc §9.6)', () => {
  it('TC-AC-107 origin ngoài CORS_ORIGINS → không có Access-Control-Allow-Origin', async () => {
    const res = await request(makeApp()).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();

    const preflight = await request(makeApp())
      .options('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('TC-AC-107 có CSP, X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer', async () => {
    const res = await request(makeApp()).get('/api/v1/health');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('connect-src');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('origin trong whitelist → ACAO đúng origin kèm credentials', async () => {
    const res = await request(makeApp()).get('/api/v1/health').set('Origin', allowed);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('REST nền tảng', () => {
  it('GET /api/v1/health → 200 ok, có X-Request-Id', async () => {
    const res = await request(makeApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', mongo: 'up', redis: 'up' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('X-Request-Id hợp lệ từ client được giữ nguyên; giá trị rác bị thay', async () => {
    const id = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    expect((await request(makeApp()).get('/api/v1/health').set('X-Request-Id', id)).headers['x-request-id']).toBe(id);
    const junk = await request(makeApp()).get('/api/v1/health').set('X-Request-Id', '<script>');
    expect(junk.headers['x-request-id']).not.toBe('<script>');
  });

  it('Mongo down → 503 degraded; Redis down → 200 degraded', async () => {
    const mongoDown = await request(makeApp({ pingMongo: () => Promise.resolve(false) })).get('/api/v1/health');
    expect(mongoDown.status).toBe(503);
    expect(healthBody(mongoDown).status).toBe('degraded');
    const redisDown = await request(makeApp({ isRedisHealthy: () => false })).get('/api/v1/health');
    expect(redisDown.status).toBe(200);
    expect(redisDown.body).toEqual({ status: 'degraded', mongo: 'up', redis: 'down' });
  });

  it('route không tồn tại → 404 NOT_FOUND với ErrorResponse có requestId', async () => {
    const res = await request(makeApp()).get('/api/v1/khong-ton-tai');
    expect(res.status).toBe(404);
    expect(errorBody(res).code).toBe('NOT_FOUND');
    expect(errorBody(res).requestId).toBe(res.headers['x-request-id']);
  });

  it('body vượt REST_BODY_LIMIT_BYTES → 413 VALIDATION_ERROR; JSON hỏng → 400 VALIDATION_ERROR', async () => {
    const big = await request(makeApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ x: 'a'.repeat(300 * 1024) }));
    expect(big.status).toBe(413);
    expect(errorBody(big).code).toBe('VALIDATION_ERROR');
    const broken = await request(makeApp()).post('/api/v1/health').set('Content-Type', 'application/json').send('{x');
    expect(broken.status).toBe(400);
    expect(errorBody(broken).code).toBe('VALIDATION_ERROR');
  });
});
