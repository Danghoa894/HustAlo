// server/src/log-scan.int.test.ts — M6: quét log toàn luồng (FR-SEC-007; AC-104, AC-ARCH-010, EC-SEC-007).
// Logger mức trace ghi vào bộ nhớ; chạy register → login → gửi tin → lấy ICE servers → gọi video (SDP, candidate) →
// refresh; rồi khẳng định log không chứa mật khẩu, access/refresh token, CSRF, nội dung tin, `a=fingerprint`,
// `candidate:` hay credential TURN (pino redact — kiến trúc §11.3).
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { EVENTS, type AckResponse, type AuthResponse } from '@hustalo/shared';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from './infra/logger/logger';
import { emitAck } from './test/chat';
import { fakeIp, readCookie, refresh, setCookieOf, startTestServer, type TestServer } from './test/factories';
import { connectAs, waitFor } from './test/socket-client';

const lines: string[] = [];
const sink = new Writable({
  write(chunk: Buffer, _enc, cb) {
    lines.push(chunk.toString('utf8'));
    cb();
  },
});

const SECRETS = {
  password: `MatKhau-${randomUUID().slice(0, 8)}`,
  content: `noi-dung-bi-mat-${randomUUID()}`,
  turnCredential: `turn-cred-${randomUUID()}`,
  fingerprint: 'a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89',
  candidate: 'candidate:842163049 1 udp 1677729535 203.0.113.7 54321 typ srflx',
};
const sdp = `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n${SECRETS.fingerprint}\r\n`;

let server: TestServer;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = await startTestServer({
    logger: createLogger({ level: 'trace', destination: sink }),
    ice: {
      stunUrls: ['stun:stun.l.google.com:19302'],
      xirsys: { ident: '', secret: '', channel: '', apiUrl: 'https://global.xirsys.net', timeoutMs: 1000 },
      turnFallback: { urls: ['turn:localhost:3478?transport=udp'], username: 'hustalo', credential: SECRETS.turnCredential },
      iceTransportPolicy: 'all',
    },
  });
  await server.reset();
}, 60_000);
afterAll(async () => {
  for (const s of sockets.splice(0)) s.close();
  await server.close();
});

const ok = <D>(r: AckResponse<D>): D => {
  if (!r.ok) throw new Error(`ACK lỗi ${r.error.code}`);
  return r.data;
};

async function register(username: string) {
  const deviceId = randomUUID();
  const res = await server
    .http()
    .post('/api/v1/auth/register')
    .set('X-Forwarded-For', fakeIp())
    .send({ email: `${username}@hustalo.test`, username, displayName: username, password: SECRETS.password, deviceId });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const body = res.body as AuthResponse;
  return {
    id: body.user.id,
    deviceId,
    accessToken: body.accessToken,
    refreshToken: readCookie(setCookieOf(res), 'hustalo_rt') ?? '',
    csrfToken: readCookie(setCookieOf(res), 'hustalo_csrf') ?? '',
  };
}

describe('log không lộ dữ liệu nhạy cảm (FR-SEC-007, kiến trúc §11.3)', () => {
  it('TC-AC-104 TC-ARCH-010 TC-SEC-007 register → login → gửi tin → ICE servers → gọi video → refresh: log không chứa mật khẩu, token, nội dung, SDP fingerprint, candidate, credential TURN', async () => {
    const alice = await register('alice_log');
    const bob = await register('bob_log');

    const login = await server
      .http()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', fakeIp())
      .send({ email: 'alice_log@hustalo.test', password: SECRETS.password, deviceId: alice.deviceId });
    expect(login.status).toBe(200);
    const aliceToken = (login.body as AuthResponse).accessToken;
    const loginRt = readCookie(setCookieOf(login), 'hustalo_rt') ?? '';
    const loginCsrf = readCookie(setCookieOf(login), 'hustalo_csrf') ?? '';

    const aSock = await connectAs(server.url, { token: aliceToken, deviceId: alice.deviceId });
    const bSock = await connectAs(server.url, { token: bob.accessToken, deviceId: bob.deviceId });
    sockets.push(aSock, bSock);
    const conversationId = (await server.runtime.conversations.getOrCreatePair('DIRECT', alice.id, bob.id)).id;

    const delivered = waitFor(bSock, EVENTS.MESSAGE_NEW);
    ok(
      await emitAck(aSock, EVENTS.MESSAGE_SEND, {
        kind: 'PLAINTEXT',
        conversationId,
        clientMessageId: randomUUID(),
        content: SECRETS.content,
      }),
    );
    await delivered;

    const ice = await server.http().get('/api/v1/calls/ice-servers').set('Authorization', `Bearer ${aliceToken}`);
    expect(ice.status).toBe(200);
    expect(JSON.stringify(ice.body)).toContain(SECRETS.turnCredential); // có trong response, không được có trong log

    bSock.on(EVENTS.CALL_INCOMING, (_p: unknown, ack?: (r: { ok: true }) => void) => ack?.({ ok: true }));
    const ringing = waitFor(aSock, EVENTS.CALL_RINGING);
    const { callId } = ok(await emitAck<{ callId: string }>(aSock, EVENTS.CALL_INVITE, { conversationId, callType: 'VIDEO' }));
    await ringing;
    ok(await emitAck(bSock, EVENTS.CALL_ACCEPT, { callId }));
    ok(await emitAck(aSock, EVENTS.CALL_OFFER, { callId, revision: 1, sdp }));
    ok(await emitAck(bSock, EVENTS.CALL_ANSWER, { callId, revision: 1, sdp }));
    const cand = { candidate: SECRETS.candidate, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abcd' };
    ok(await emitAck(aSock, EVENTS.CALL_ICE_CANDIDATE, { callId, revision: 1, candidate: cand }));
    ok(await emitAck(aSock, EVENTS.CALL_STATE, { callId, connectionState: 'connected' }));
    ok(await emitAck(aSock, EVENTS.CALL_END, { callId, reason: 'HANGUP' }));

    const refreshed = await refresh(server, { refreshToken: loginRt, csrfToken: loginCsrf });
    expect(refreshed.status).toBe(200);
    const newAccess = (refreshed.body as AuthResponse).accessToken;
    const newRt = readCookie(setCookieOf(refreshed), 'hustalo_rt') ?? '';

    await new Promise((r) => setTimeout(r, 200)); // log bất đồng bộ của pino
    const log = lines.join('');
    expect(lines.length).toBeGreaterThan(10); // log capture thực sự hoạt động (mức trace)

    const forbidden: Record<string, string> = {
      password: SECRETS.password,
      'access token (register)': alice.accessToken,
      'access token (login)': aliceToken,
      'access token (refresh)': newAccess,
      'refresh token (register)': alice.refreshToken,
      'refresh token (login)': loginRt,
      'refresh token (refresh)': newRt,
      'CSRF token': loginCsrf,
      'nội dung tin': SECRETS.content,
      'credential TURN': SECRETS.turnCredential,
      'SDP a=fingerprint': 'a=fingerprint',
      'ICE candidate:': 'candidate:842163049',
    };
    const leaked = Object.entries(forbidden)
      .filter(([, v]) => v !== '' && log.includes(v))
      .map(([k]) => k);
    expect(leaked).toEqual([]);
  }, 60_000);
});
