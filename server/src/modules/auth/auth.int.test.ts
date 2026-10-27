import { randomUUID } from 'node:crypto';
import { SessionRevokeReason, type AuthResponse, type ErrorResponse } from '@hustalo/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TEST_PASSWORD,
  createUser,
  fakeIp,
  login,
  readCookie,
  refresh,
  setCookieOf,
  startTestServer,
  type TestServer,
} from '../../test/factories';
import { connectAs, waitDisconnect, waitFor } from '../../test/socket-client';
import { UserModel } from '../users/user.model';
import { createAuthRepository } from './auth.repository';
import { createAuthService } from './auth.service';
import { RefreshSessionModel } from './refreshSession.model';

const errorOf = (res: { body: unknown }) => (res.body as ErrorResponse).error;
const authOf = (res: { body: unknown }) => res.body as AuthResponse;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

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

const registerBody = (o: Partial<Record<string, string>> = {}) => ({
  email: 'dave@example.com',
  username: 'dave',
  password: 'matkhau123',
  displayName: 'Dave',
  deviceId: randomUUID(),
  ...o,
});

describe('POST /auth/register (FR-AUTH-001)', () => {
  it('TC-AC-001 201 AuthResponse, cookie hustalo_rt HttpOnly/Secure/Strict/Path=/api/v1/auth, hustalo_csrf Path=/, hash argon2id', async () => {
    const res = await server.http().post('/api/v1/auth/register').set('X-Forwarded-For', fakeIp()).send(registerBody());
    expect(res.status).toBe(201);
    const body = authOf(res);
    expect(body.user).toMatchObject({ email: 'dave@example.com', username: 'dave', displayName: 'Dave', blockedUserIds: [] });
    expect(body.accessToken.split('.')).toHaveLength(3);
    const cookies = setCookieOf(res) ?? [];
    const rt = cookies.find((c) => c.startsWith('hustalo_rt=')) ?? '';
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/Secure/i);
    expect(rt).toMatch(/SameSite=Strict/i);
    expect(rt).toMatch(/Path=\/api\/v1\/auth/);
    const csrf = cookies.find((c) => c.startsWith('hustalo_csrf=')) ?? '';
    expect(csrf).toMatch(/Path=\//);
    expect(csrf).not.toMatch(/HttpOnly/i);
    const stored = await UserModel.findOne({ email: 'dave@example.com' }).select('+passwordHash').lean().exec();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('TC-AC-002 TC-AUTH-001 hai request cùng email song song → đúng một 201, còn lại 409 details.field=email', async () => {
    const [a, b] = await Promise.all([
      server.http().post('/api/v1/auth/register').set('X-Forwarded-For', fakeIp()).send(registerBody({ username: 'eve1', email: 'eve@example.com' })),
      server.http().post('/api/v1/auth/register').set('X-Forwarded-For', fakeIp()).send(registerBody({ username: 'eve2', email: 'eve@example.com' })),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const conflict = a.status === 409 ? a : b;
    expect(errorOf(conflict).code).toBe('CONFLICT');
    expect(errorOf(conflict).details).toEqual({ field: 'email' });
    expect(await UserModel.countDocuments({ email: 'eve@example.com' })).toBe(1);
  });

  it('TC-AUTH-001 trùng username → 409 details.field=username', async () => {
    await createUser({ username: 'taken' });
    const res = await server
      .http()
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', fakeIp())
      .send(registerBody({ username: 'taken', email: 'other@example.com' }));
    expect(res.status).toBe(409);
    expect(errorOf(res).details).toEqual({ field: 'username' });
  });

  it('mật khẩu không có số / trùng username / username chữ hoa → 400 VALIDATION_ERROR', async () => {
    for (const o of [{ password: 'chikhongso' }, { password: 'dave1234', username: 'dave1234' }, { username: 'Dave' }]) {
      const res = await server.http().post('/api/v1/auth/register').set('X-Forwarded-For', fakeIp()).send(registerBody(o));
      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('POST /auth/login (FR-AUTH-002)', () => {
  it('TC-AC-003 sai mật khẩu / email không tồn tại / LOCKED → 401 cùng message; chênh lệch trung vị < 50 ms', async () => {
    const alice = await createUser({ email: 'alice@hustalo.local', username: 'alice' });
    const attempt = async (email: string, password: string) => {
      const t0 = performance.now();
      const res = await server
        .http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', fakeIp())
        .send({ email, password, deviceId: randomUUID() });
      return { res, ms: performance.now() - t0 };
    };
    const wrong: number[] = [];
    const missing: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const w = await attempt(alice.email, 'sai-mat-khau-1');
      const m = await attempt('khong-ton-tai@hustalo.local', 'sai-mat-khau-1');
      for (const { res } of [w, m]) {
        expect(res.status).toBe(401);
        expect(errorOf(res)).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Email hoặc mật khẩu không đúng' });
      }
      wrong.push(w.ms);
      missing.push(m.ms);
    }
    expect(Math.abs(median(wrong) - median(missing))).toBeLessThan(50);

    await UserModel.updateOne({ _id: alice.id }, { $set: { status: 'LOCKED' } });
    const locked = await attempt(alice.email, TEST_PASSWORD);
    expect(locked.res.status).toBe(401);
    expect(errorOf(locked.res).message).toBe('Email hoặc mật khẩu không đúng');
  });

  it('TC-AC-004 TC-SEC-005 lần sai thứ 6 cùng IP+email trong 60 s → 429 Retry-After; email khác cùng IP vẫn xử lý', async () => {
    const alice = await createUser();
    const ip = fakeIp();
    const post = (email: string) =>
      server
        .http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email, password: 'sai-mat-khau-1', deviceId: randomUUID() });
    for (let i = 0; i < 5; i += 1) expect((await post(alice.email)).status).toBe(401);
    const sixth = await post(alice.email);
    expect(sixth.status).toBe(429);
    expect(errorOf(sixth).code).toBe('RATE_LIMITED');
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    expect((await post('nguoi-khac@hustalo.local')).status).toBe(401);
  });

  it('TC-AC-108 hash tham số cũ (timeCost=1) được rehash timeCost=2 khi đăng nhập; /auth/me không chứa passwordHash', async () => {
    const u = await createUser({ timeCost: 1 });
    const before = await UserModel.findById(u.id).select('+passwordHash').lean().exec();
    expect(before?.passwordHash).toContain('t=1');
    const s = await login(server, u.email);
    const after = await UserModel.findById(u.id).select('+passwordHash').lean().exec();
    expect(after?.passwordHash).toContain('t=2');
    const me = await server.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${s.accessToken}`);
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|argon2/);
    expect(JSON.stringify(s.body)).not.toMatch(/passwordHash|argon2/);
  });

  it('đăng nhập lại cùng deviceId thu hồi family cũ của device (LOGOUT)', async () => {
    const u = await createUser();
    const deviceId = randomUUID();
    const first = await login(server, u.email, deviceId);
    await login(server, u.email, deviceId);
    expect((await refresh(server, first)).status).toBe(401);
    const me = await server.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${first.accessToken}`);
    expect(me.status).toBe(401);
  });
});

describe('POST /auth/refresh (FR-AUTH-003, D-19)', () => {
  it('TC-AC-005 refresh với R1 + CSRF → 200, access token mới, cookie R2 ≠ R1; R2 refresh tiếp được', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const r = await refresh(server, s);
    expect(r.status).toBe(200);
    const r2 = readCookie(setCookieOf(r), 'hustalo_rt') ?? '';
    expect(r2).not.toBe('');
    expect(r2).not.toBe(s.refreshToken);
    expect(authOf(r).accessToken).not.toBe(s.accessToken);
    expect((await refresh(server, { ...s, refreshToken: r2 })).status).toBe(200);
  });

  it('TC-AC-006 TC-AUTH-004 dùng lại R1 sau khi đã xoay R2→R3 → 401, thu hồi family, R3 hết dùng được, socket nhận session:revoked REFRESH_REUSE', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const socket = await connectAs(server.url, { token: s.accessToken, deviceId: s.deviceId });
    const r2 = readCookie(setCookieOf(await refresh(server, s)), 'hustalo_rt') ?? '';
    const r3 = readCookie(setCookieOf(await refresh(server, { ...s, refreshToken: r2 })), 'hustalo_rt') ?? '';
    const revoked = waitFor<{ reason: string; eventId: string }>(socket, 'session:revoked');
    const disconnected = waitDisconnect(socket);

    const reuse = await refresh(server, s);
    expect(reuse.status).toBe(401);
    expect(setCookieOf(reuse)?.some((c) => c.startsWith('hustalo_rt=;'))).toBe(true);
    expect((await revoked).reason).toBe(SessionRevokeReason.REFRESH_REUSE);
    await disconnected;
    expect((await refresh(server, { ...s, refreshToken: r3 })).status).toBe(401);
    const familyDocs = await RefreshSessionModel.find({ userId: u.id }).lean().exec();
    expect(familyDocs.every((d) => d.revokedAt !== null && d.revokeReason === 'REFRESH_REUSE')).toBe(true);
    const me = await server.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${s.accessToken}`);
    expect(me.status).toBe(401);
  });

  it('TC-AC-007 TC-ARCH-013 TC-AUTH-003 TC-DB-018 hai tab refresh cùng R trong 1 s → một 200, một 409; retry với cookie mới thành công; family không bị thu hồi', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const [a, b] = await Promise.all([refresh(server, s), refresh(server, s)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 409 ? a : b;
    expect(errorOf(loser).code).toBe('CONFLICT');
    // Tab thua đọc cookie mới (trình duyệt dùng chung cookie) và thử lại một lần.
    const newRt = readCookie(setCookieOf(winner), 'hustalo_rt') ?? '';
    const retry = await refresh(server, { ...s, refreshToken: newRt });
    expect(retry.status).toBe(200);
    expect(await RefreshSessionModel.countDocuments({ userId: u.id, revokedAt: { $ne: null } })).toBe(0);
    const me = await server.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${authOf(retry).accessToken}`);
    expect(me.status).toBe(200);
  });

  it('TC-DB-019 dùng lại token ngoài cửa sổ grace (> 10 s) → updateMany thu hồi mọi thế hệ trong family', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    expect((await refresh(server, s)).status).toBe(200);
    // Service riêng với đồng hồ lệch +11 s (cùng repository/DB) để vượt REFRESH_REUSE_GRACE_S.
    const later = createAuthService({
      repo: createAuthRepository(server.redis),
      notifier: { sessionRevoked: () => undefined },
      now: () => new Date(Date.now() + 11_000),
    });
    await expect(later.refresh(s.refreshToken, { ip: '', userAgent: '' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const docs = await RefreshSessionModel.find({ userId: u.id }).lean().exec();
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.revokedAt !== null && d.revokeReason === 'REFRESH_REUSE')).toBe(true);
  });

  it('TC-AC-102 TC-SEC-004 thiếu hoặc sai X-CSRF-Token → 403 FORBIDDEN, token không bị xoay', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const missing = await refresh(server, s, null);
    expect(missing.status).toBe(403);
    expect(errorOf(missing).code).toBe('FORBIDDEN');
    expect((await refresh(server, s, 'sai-gia-tri')).status).toBe(403);
    expect(await RefreshSessionModel.countDocuments({ userId: u.id })).toBe(1);
    expect((await refresh(server, s)).status).toBe(200); // R1 vẫn là token hiện hành
  });

  it('TC-SEC-004 logout thiếu CSRF → 403; logout hợp lệ → 204, xóa cookie, family thu hồi; gọi lại vẫn 204', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const cookies = [`hustalo_rt=${s.refreshToken}`, `hustalo_csrf=${s.csrfToken}`];
    expect((await server.http().post('/api/v1/auth/logout').set('Cookie', cookies)).status).toBe(403);
    const out = await server.http().post('/api/v1/auth/logout').set('Cookie', cookies).set('X-CSRF-Token', s.csrfToken);
    expect(out.status).toBe(204);
    expect(setCookieOf(out)?.some((c) => c.startsWith('hustalo_rt=;'))).toBe(true);
    expect((await refresh(server, s)).status).toBe(401);
    const again = await server.http().post('/api/v1/auth/logout').set('Cookie', cookies).set('X-CSRF-Token', s.csrfToken);
    expect(again.status).toBe(204);
  });

  it('refresh token rác / không có cookie → 401 UNAUTHENTICATED', async () => {
    const r = await refresh(server, { refreshToken: 'khong-ton-tai', csrfToken: 'c' });
    expect(r.status).toBe(401);
  });
});

describe('POST /auth/change-password (FR-AUTH-005)', () => {
  it('TC-AC-009 TC-AUTH-006 đổi mật khẩu từ device 1 → 204; device 2, 3 nhận session:revoked PASSWORD_CHANGED, refresh 401; device 1 vẫn dùng được', async () => {
    const u = await createUser();
    const [d1, d2, d3] = [await login(server, u.email), await login(server, u.email), await login(server, u.email)];
    const s2 = await connectAs(server.url, { token: d2.accessToken, deviceId: d2.deviceId });
    const s3 = await connectAs(server.url, { token: d3.accessToken, deviceId: d3.deviceId });
    const events = Promise.all([waitFor<{ reason: string }>(s2, 'session:revoked'), waitFor<{ reason: string }>(s3, 'session:revoked')]);

    const res = await server
      .http()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${d1.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'matkhaumoi456' });
    expect(res.status).toBe(204);
    expect((await events).map((e) => e.reason)).toEqual(['PASSWORD_CHANGED', 'PASSWORD_CHANGED']);
    expect((await refresh(server, d2)).status).toBe(401);
    expect((await refresh(server, d3)).status).toBe(401);
    const me = await server.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${d1.accessToken}`);
    expect(me.status).toBe(200);
    expect((await refresh(server, d1)).status).toBe(200);
    const relogin = await server
      .http()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', fakeIp())
      .send({ email: u.email, password: 'matkhaumoi456', deviceId: randomUUID() });
    expect(relogin.status).toBe(200);
  });

  it('TC-AC-018 TC-AUTH-008 sai currentPassword 5 lần → 422 details currentPassword INVALID, phiên còn dùng được; lần 6 → 429 Retry-After', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const change = (currentPassword: string) =>
      server
        .http()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${s.accessToken}`)
        .send({ currentPassword, newPassword: 'matkhaumoi456' });
    for (let i = 0; i < 5; i += 1) {
      const r = await change('sai-mat-khau-9');
      expect(r.status).toBe(422);
      expect(errorOf(r)).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'currentPassword', reason: 'INVALID' }],
      });
    }
    const sixth = await change(TEST_PASSWORD);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    const me = await server.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${s.accessToken}`);
    expect(me.status).toBe(200);
    expect((await refresh(server, s)).status).toBe(200);
    const stored = await UserModel.findById(u.id).select('+passwordHash passwordChangedAt').lean().exec();
    expect(stored?.passwordChangedAt ?? null).toBeNull();
  });

  it('newPassword trùng mật khẩu hiện tại → 400 VALIDATION_ERROR', async () => {
    const u = await createUser();
    const s = await login(server, u.email);
    const r = await server
      .http()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });
    expect(r.status).toBe(400);
  });
});

describe('authenticate (FR-SEC-008)', () => {
  it('không có / sai Bearer → 401 trên route cần xác thực', async () => {
    expect((await server.http().get('/api/v1/auth/me')).status).toBe(401);
    expect((await server.http().get('/api/v1/auth/me').set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
    expect((await server.http().get('/api/v1/users/search?q=ab')).status).toBe(401);
  });
});

describe('Redis down (D-10)', () => {
  it('TC-SEC-005 rate limit login fail-closed → 503 SERVICE_UNAVAILABLE', async () => {
    await server.close();
    const down = await startTestServer({ redisUrl: 'redis://127.0.0.1:1/0' });
    try {
      const u = await createUser();
      const res = await down
        .http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', fakeIp())
        .send({ email: u.email, password: TEST_PASSWORD, deviceId: randomUUID() });
      expect(res.status).toBe(503);
      expect(errorOf(res).code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      await down.close();
      server = await startTestServer();
    }
  });
});
