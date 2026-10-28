// server/src/test/factories.ts — dựng runtime thật (Express + Socket.IO + Mongo replset + Redis test) cho integration test,
// tạo user trực tiếp (tránh rate limit register), đăng nhập và đọc cookie.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { normalizeForSearch, type AuthResponse } from '@hustalo/shared';
import request from 'supertest';
import { hashPassword } from '../infra/crypto/password';
import { ALL_MODELS } from '../infra/db/indexes';
import { connectMongo, disconnectMongo } from '../infra/db/mongo';
import { createLogger } from '../infra/logger/logger';
import { createRedis, type RedisHandle } from '../infra/redis/redis';
import { createRuntime, type Runtime } from '../main';
import { UserModel } from '../modules/users/user.model';

export const TEST_PASSWORD = 'matkhau123';

export interface TestServer {
  runtime: Runtime;
  url: string;
  redis: RedisHandle;
  http: () => ReturnType<typeof request>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function startTestServer(opts: { redisUrl?: string } = {}): Promise<TestServer> {
  await connectMongo(process.env.MONGODB_URI ?? '');
  const redis = createRedis(opts.redisUrl ?? process.env.REDIS_URL ?? '');
  if (!opts.redisUrl) await redis.client.connect();
  const runtime = await createRuntime({ redis, logger: createLogger({ level: 'silent' }) });
  await new Promise<void>((resolve) => runtime.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = runtime.httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  return {
    runtime,
    url,
    redis,
    http: () => request(url),
    async reset() {
      if (redis.isHealthy()) await redis.client.flushdb();
      for (const m of ALL_MODELS) await (m as unknown as { deleteMany(f: object): Promise<unknown> }).deleteMany({});
    },
    async close() {
      await runtime.close();
      await redis.close();
      await disconnectMongo();
    },
  };
}

let seq = 0;

/** Tạo user ACTIVE trực tiếp trong DB. `timeCost` để giả lập hash tham số cũ (AC-108). */
export async function createUser(
  overrides: Partial<{ email: string; username: string; displayName: string; password: string; timeCost: number }> = {},
) {
  seq += 1;
  const username = overrides.username ?? `user${String(Date.now()).slice(-6)}${seq}`;
  const displayName = overrides.displayName ?? `Người dùng ${seq}`;
  const email = overrides.email ?? `${username}@hustalo.local`;
  const doc = await UserModel.create({
    email,
    username,
    displayName,
    displayNameNormalized: normalizeForSearch(displayName),
    passwordHash: await hashPassword(
      overrides.password ?? TEST_PASSWORD,
      overrides.timeCost === undefined ? {} : { timeCost: overrides.timeCost },
    ),
  });
  return { id: String(doc._id), email, username, displayName };
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  deviceId: string;
  body: AuthResponse;
}

/** Lấy giá trị cookie từ header Set-Cookie. */
export function readCookie(setCookie: string[] | string | undefined, name: string): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const c of list) {
    const [pair] = c.split(';');
    const [k, ...v] = (pair ?? '').split('=');
    if (k?.trim() === name) return v.join('=');
  }
  return undefined;
}

export const setCookieOf = (res: { headers: Record<string, unknown> }) =>
  res.headers['set-cookie'] as string[] | undefined;

/** IP giả qua X-Forwarded-For (TRUST_PROXY=1) để tách bucket rate limit giữa các test. */
export const fakeIp = () => `10.${seq % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

export async function login(server: TestServer, email: string, deviceId: string = randomUUID()): Promise<Session> {
  const res = await server
    .http()
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', fakeIp())
    .send({ email, password: TEST_PASSWORD, deviceId });
  if (res.status !== 200) throw new Error(`login thất bại: ${String(res.status)}`);
  const body = res.body as AuthResponse;
  return {
    accessToken: body.accessToken,
    refreshToken: readCookie(setCookieOf(res), 'hustalo_rt') ?? '',
    csrfToken: readCookie(setCookieOf(res), 'hustalo_csrf') ?? '',
    deviceId,
    body,
  };
}

/** POST /auth/refresh với cookie + header CSRF. */
export function refresh(
  server: TestServer,
  s: { refreshToken: string; csrfToken: string },
  csrfHeader?: string | null,
) {
  const req = server
    .http()
    .post('/api/v1/auth/refresh')
    .set('X-Forwarded-For', fakeIp())
    .set('Cookie', [`hustalo_rt=${s.refreshToken}`, `hustalo_csrf=${s.csrfToken}`]);
  if (csrfHeader !== null) req.set('X-CSRF-Token', csrfHeader ?? s.csrfToken);
  return req;
}
