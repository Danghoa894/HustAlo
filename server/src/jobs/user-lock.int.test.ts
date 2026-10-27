import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_PASSWORD, createUser, fakeIp, login, startTestServer, type TestServer } from '../test/factories';
import { connectAs, connectError, waitDisconnect, waitFor } from '../test/socket-client';
import { UserModel } from '../modules/users/user.model';
import { runUserLock } from './user-lock';

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

describe('user:lock / user:unlock (FR-AUTH-006, DG-03)', () => {
  it('TC-AC-010 TC-AUTH-005 hai socket nhận session:revoked ACCOUNT_LOCKED và bị ngắt; REST token cũ 401; reconnect bị UNAUTHENTICATED', async () => {
    const u = await createUser();
    const d1 = await login(server, u.email);
    const d2 = await login(server, u.email);
    const s1 = await connectAs(server.url, { token: d1.accessToken, deviceId: d1.deviceId });
    const s2 = await connectAs(server.url, { token: d2.accessToken, deviceId: d2.deviceId });
    const events = Promise.all([waitFor<{ reason: string }>(s1, 'session:revoked'), waitFor<{ reason: string }>(s2, 'session:revoked')]);
    const closed = Promise.all([waitDisconnect(s1), waitDisconnect(s2)]);

    // Job chạy như process riêng: chỉ ghi Mongo/Redis rồi publish ops:user-locked.
    expect(await runUserLock('lock', u.email)).toBe(true);

    expect((await events).map((e) => e.reason)).toEqual(['ACCOUNT_LOCKED', 'ACCOUNT_LOCKED']);
    await closed;
    expect((await UserModel.findById(u.id).lean().exec())?.status).toBe('LOCKED');
    const me = await server.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${d1.accessToken}`);
    expect(me.status).toBe(401);
    expect(await connectError(server.url, { token: d1.accessToken, deviceId: d1.deviceId })).toBe('UNAUTHENTICATED');
    const relogin = await server
      .http()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', fakeIp())
      .send({ email: u.email, password: TEST_PASSWORD, deviceId: randomUUID() });
    expect(relogin.status).toBe(401);
  });

  it('user:unlock → đăng nhập lại được; email không tồn tại → false', async () => {
    const u = await createUser();
    await runUserLock('lock', u.email);
    expect(await runUserLock('unlock', u.email)).toBe(true);
    const s = await login(server, u.email);
    expect(s.accessToken).toBeTruthy();
    expect(await runUserLock('lock', 'khong-co@hustalo.local')).toBe(false);
  });
});
