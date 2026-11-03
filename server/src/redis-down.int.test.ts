// server/src/redis-down.int.test.ts — M6: hành vi khi Redis không truy cập được (kiến trúc §10.2, D-10; FR-SEC-005;
// AC-ARCH-009, AC-109, EC-INFRA-002). Phiên đăng nhập lấy trên server khỏe trước, rồi chạy server với Redis "chết"
// (cổng 1) dùng chung Mongo: auth fail-closed, chat vẫn chạy với limiter bộ nhớ, presence degraded, call:invite 503.
import { randomUUID } from 'node:crypto';
import { EVENTS, RATE_LIMITS, type ErrorResponse, type HealthResponse } from '@hustalo/shared';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitAck, type ChatUser } from './test/chat';
import { TEST_PASSWORD, createUser, fakeIp, login, startTestServer, type TestServer } from './test/factories';
import { connectAs, waitFor } from './test/socket-client';

let down: TestServer;
const sockets: Socket[] = [];
let alice: ChatUser;
let bob: ChatUser;
let conversationId: string;

beforeAll(async () => {
  const healthy = await startTestServer();
  await healthy.reset();
  const [a, b] = [await createUser({ username: 'alice' }), await createUser({ username: 'bob' })];
  const [sa, sb] = [await login(healthy, a.email), await login(healthy, b.email)];
  conversationId = (await healthy.runtime.conversations.getOrCreatePair('DIRECT', a.id, b.id)).id;
  await healthy.close();

  down = await startTestServer({ redisUrl: 'redis://127.0.0.1:1/0' });
  const open = async (id: string, email: string, s: typeof sa): Promise<ChatUser> => {
    const sock = await connectAs(down.url, { token: s.accessToken, deviceId: s.deviceId });
    sockets.push(sock);
    return { id, email, s, sock };
  };
  alice = await open(a.id, a.email, sa);
  bob = await open(b.id, b.email, sb);
}, 60_000);

afterAll(async () => {
  for (const s of sockets.splice(0)) s.close();
  await down.close();
});

const errorOf = (res: { body: unknown }) => (res.body as ErrorResponse).error;

describe('Redis down (kiến trúc §10.2, D-10)', () => {
  it('TC-ARCH-009 /health → 200 degraded (redis down, mongo up)', async () => {
    const res = await down.http().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body as HealthResponse).toMatchObject({ status: 'degraded', mongo: 'up', redis: 'down' });
  });

  it('TC-ARCH-009 TC-AC-109 TC-INFRA-002 đăng nhập → 503 SERVICE_UNAVAILABLE (auth fail-closed)', async () => {
    const res = await down
      .http()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', fakeIp())
      .send({ email: alice.email, password: TEST_PASSWORD, deviceId: randomUUID() });
    expect(res.status).toBe(503);
    expect(errorOf(res).code).toBe('SERVICE_UNAVAILABLE');
  });

  it(`TC-ARCH-009 TC-AC-109 gửi 25 tin trong 10 s → ${RATE_LIMITS.messageSend.points} tin đầu thành công, từ tin ${RATE_LIMITS.messageSend.points + 1} RATE_LIMITED (limiter bộ nhớ)`, async () => {
    const got = waitFor(bob.sock, EVENTS.MESSAGE_NEW);
    const results: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const ack = await emitAck(alice.sock, EVENTS.MESSAGE_SEND, {
        kind: 'PLAINTEXT',
        conversationId,
        clientMessageId: randomUUID(),
        content: `tin ${String(i + 1)}`,
      });
      results.push(ack.ok ? 'ok' : ack.error.code);
    }
    const n = RATE_LIMITS.messageSend.points;
    expect(results.slice(0, n)).toEqual(Array<string>(n).fill('ok'));
    expect(new Set(results.slice(n))).toEqual(new Set(['RATE_LIMITED']));
    await got; // bob vẫn nhận realtime (adapter bộ nhớ, không cần Redis)
  });

  it('TC-INFRA-002 presence:subscribe → snapshot degraded, mọi người OFFLINE, không lộ lastSeen', async () => {
    const snap = waitFor<{ users: { userId: string; status: string; lastSeenAt: string | null }[]; degraded: boolean }>(
      alice.sock,
      EVENTS.PRESENCE_SNAPSHOT,
    );
    await emitAck(alice.sock, EVENTS.PRESENCE_SUBSCRIBE, { userIds: [bob.id] });
    const s = await snap;
    expect(s.degraded).toBe(true);
    expect(s.users).toEqual([expect.objectContaining({ userId: bob.id, status: 'OFFLINE', lastSeenAt: null })]);
  });

  it('TC-INFRA-002 call:invite → SERVICE_UNAVAILABLE ("Không thể thực hiện cuộc gọi lúc này" ở client)', async () => {
    const ack = await emitAck(bob.sock, EVENTS.CALL_INVITE, { conversationId, callType: 'VOICE' });
    expect(ack).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
