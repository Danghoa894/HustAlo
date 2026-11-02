import { randomUUID } from 'node:crypto';
import { SESSION_EXPIRED_DISCONNECT_DELAY_MS } from '@hustalo/shared';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../infra/jwt/jwt';
import {
  createUser,
  login,
  refresh,
  readCookie,
  setCookieOf,
  startTestServer,
  type TestServer,
} from '../test/factories';
import { io } from 'socket.io-client';
import { connectAs, connectError, waitDisconnect, waitFor } from '../test/socket-client';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('socket handshake (AUTHZ-1, kiến trúc §7(a))', () => {
  it('token hợp lệ + deviceId khớp did → kết nối được', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const socket = await connectAs(server.url, { token: s.accessToken, deviceId: s.deviceId });
    expect(socket.connected).toBe(true);
    socket.close();
  });

  it('TC-AUTH-002 handshake với token đã hết hạn → connect_error TOKEN_EXPIRED', async () => {
    const deviceId = randomUUID();
    const { token } = await signAccessToken(
      { userId: String(new Types.ObjectId()), sid: String(new Types.ObjectId()), deviceId },
      new Date(Date.now() - 3_600_000),
    );
    expect(await connectError(server.url, { token, deviceId })).toBe('TOKEN_EXPIRED');
  });

  it('tabId thiếu / không phải UUID v4 / quá dài → connect_error UNAUTHENTICATED (kiến trúc §6.4: tabId là UUID v4)', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const raw = (auth: Record<string, unknown>) =>
      new Promise<string>((resolve) => {
        const sock = io(server.url, {
          path: '/socket.io',
          transports: ['websocket'],
          reconnection: false,
          forceNew: true,
          auth,
        });
        sock.once('connect', () => {
          sock.close();
          resolve('CONNECTED');
        });
        sock.once('connect_error', (err: Error) => {
          sock.close();
          resolve(err.message);
        });
      });
    const base = { token: s.accessToken, deviceId: s.deviceId };
    expect(await raw(base)).toBe('UNAUTHENTICATED');
    expect(await raw({ ...base, tabId: 'tab-1' })).toBe('UNAUTHENTICATED');
    expect(await raw({ ...base, tabId: '6f1c2a3b-4d5e-1f60-8a7b-9c0d1e2f3a4b' })).toBe('UNAUTHENTICATED'); // UUID v1
    expect(await raw({ ...base, tabId: `${randomUUID()}${'x'.repeat(1000)}` })).toBe('UNAUTHENTICATED');
    expect(await raw({ ...base, tabId: randomUUID() })).toBe('CONNECTED');
  });

  it('deviceId khác claim did / token rác / thiếu auth → connect_error UNAUTHENTICATED', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    expect(await connectError(server.url, { token: s.accessToken, deviceId: randomUUID() })).toBe('UNAUTHENTICATED');
    expect(await connectError(server.url, { token: 'rac', deviceId: s.deviceId })).toBe('UNAUTHENTICATED');
  });

  it('session đã thu hồi (logout) → reconnect bị connect_error UNAUTHENTICATED', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    await server
      .http()
      .post('/api/v1/auth/logout')
      .set('Cookie', [`hustalo_rt=${s.refreshToken}`, `hustalo_csrf=${s.csrfToken}`])
      .set('X-CSRF-Token', s.csrfToken);
    expect(await connectError(server.url, { token: s.accessToken, deviceId: s.deviceId })).toBe('UNAUTHENTICATED');
  });
});

describe('session:expired (FR-AUTH-007, D-18)', () => {
  it('TC-AC-011 TC-ARCH-014 TC-AUTH-002 token còn 2 s: tới exp nhận session:expired, sau 5 s bị ngắt; refresh rồi reconnect thành công', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    // Token ngắn hạn cùng sid/did của phiên vừa đăng nhập (exp sau 2 s).
    const { token } = await signAccessToken(
      { userId: u.id, sid: sidOf(s.accessToken), deviceId: s.deviceId },
      new Date(),
      2,
    );

    // Chỉ giả lập timer (không giả lập Date) để JWT vẫn hợp lệ lúc handshake; thời gian thật vẫn trôi.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const socket = await connectAs(server.url, { token, deviceId: s.deviceId });
    const expired = waitFor<{ reason: string; expiredAt: string; eventId: string }>(socket, 'session:expired', 60_000);
    const disconnected = waitDisconnect(socket, 60_000);

    await vi.advanceTimersByTimeAsync(2_000);
    const evt = await expired;
    expect(evt.reason).toBe('TOKEN_EXPIRED');
    expect(Number.isNaN(Date.parse(evt.expiredAt))).toBe(false);
    expect(evt.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(socket.connected).toBe(true); // chưa ngắt ngay

    await vi.advanceTimersByTimeAsync(SESSION_EXPIRED_DISCONNECT_DELAY_MS);
    expect(await disconnected).toBe('io server disconnect');
    vi.useRealTimers();

    // Client refresh → token mới → reconnect thành công.
    const r = await refresh(server, s);
    expect(r.status).toBe(200);
    expect(readCookie(setCookieOf(r), 'hustalo_rt')).toBeTruthy();
    const again = await connectAs(server.url, {
      token: (r.body as { accessToken: string }).accessToken,
      deviceId: s.deviceId,
    });
    expect(again.connected).toBe(true);
    again.close();
  });
});

/** Đọc claim sid từ JWT (payload base64url) — chỉ trong test. */
function sidOf(jwt: string): string {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sid: string };
  return payload.sid;
}
