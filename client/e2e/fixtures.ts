// client/e2e/fixtures.ts — helper E2E (development_guide.md §6.6)
// - newUser(): tài khoản mới duy nhất cho mỗi test (không phụ thuộc seed, không đụng mật khẩu của alice/bob/carol).
// - registerViaApi / loginAs: tạo và đăng nhập qua REST rồi nạp token bằng /auth/refresh như reload thật.
//   deviceId của REST login được ghi vào localStorage trước khi trang chạy, để claim `did` khớp handshake socket.
// - clearRateLimits(): xóa khóa {prefix}rl:* trong Redis dev trước mỗi test (register chỉ 3/phút/IP). Chỉ chạy local;
//   với E2E_BASE_URL (môi trường đã deploy) thì bỏ qua.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext, type Page, type WebSocket } from '@playwright/test';
import { Redis } from 'ioredis';

export interface E2eUser {
  email: string;
  username: string;
  displayName: string;
  password: string;
}

let seq = 0;
export function newUser(): E2eUser {
  seq += 1;
  const tag = `${Date.now().toString(36)}${seq}${Math.floor(Math.random() * 1e4).toString(36)}`;
  return {
    email: `e2e.${tag}@hustalo.test`,
    username: `e2e_${tag}`,
    displayName: `E2E ${tag}`,
    password: `Secret${tag}9`,
  };
}

function redisUrl(): string | undefined {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const envFile = fileURLToPath(new URL('../../server/.env', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return process.env.REDIS_URL;
}

export async function clearRateLimits(): Promise<void> {
  if (process.env.E2E_BASE_URL) return;
  const url = redisUrl();
  if (!url) throw new Error('E2E cần REDIS_URL (server/.env) để xóa khóa rate limit rl:*');
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', '*rl:*', 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}

export async function registerViaApi(request: APIRequestContext, user: E2eUser): Promise<void> {
  const res = await request.post('/api/v1/auth/register', {
    data: {
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      password: user.password,
      deviceId: randomUUID(),
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** Đăng nhập REST bằng cookie của context `page`, rồi mở `path` — RequireAuth tự refresh như khi reload. */
export async function loginAs(page: Page, user: E2eUser, path = '/chats'): Promise<void> {
  const deviceId = randomUUID();
  await page.addInitScript((id) => {
    localStorage.setItem('hustalo.deviceId', id);
  }, deviceId);
  const res = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password, deviceId },
  });
  expect(res.status(), await res.text()).toBe(200);
  await page.goto(path);
}

/** Chờ handshake Socket.IO thành công (gói CONNECT "40{…}" từ server) trên WebSocket mở sau lời gọi này. */
export async function waitForSocketConnected(page: Page): Promise<void> {
  const ws: WebSocket = await page.waitForEvent('websocket', (w) => w.url().includes('/socket.io/'));
  await ws.waitForEvent('framereceived', (f) => typeof f.payload === 'string' && f.payload.startsWith('40'));
}
