// Integration cuộc gọi 1-1 (FR-CALL-001..011): socket thật + Redis test + Mongo replset. Thời gian rút ngắn tỉ lệ
// qua `callTiming` (thật: ring 45 s, connect 30 s, reconnect/peer grace 20 s, ack call:incoming 5 s, sweep 1 s).
import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EVENTS, type AckResponse, type CallStatus, type Message } from '@hustalo/shared';
import { Types } from 'mongoose';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { metrics } from '../../infra/metrics/metrics';
import { keys } from '../../infra/redis/keys';
import { chatUser, collect, emitAck, extraSocket, sleep, type ChatUser } from '../../test/chat';
import { createUser, login, startTestServer, type TestServer } from '../../test/factories';
import { connectAs, openSocket } from '../../test/socket-client';
import { usersService } from '../users/users.service';
import { CallHistoryModel } from './callHistory.model';
import { createCallStateRepository } from './callState.repository';
import { callsRepository } from './calls.repository';

// incomingAckMs lớn hơn hẳn độ trễ ACK thật: test RINGING-ngay-khi-ACK-đầu-tiên phân biệt được với chờ hết hạn.
const TIMING = { ringMs: 1500, connectMs: 1500, reconnectMs: 700, peerGraceMs: 500, incomingAckMs: 1500, sweepMs: 50 };

// Xirsys giả: trả lỗi 500 hoặc một cấu hình hợp lệ, đếm số lần bị gọi.
let xirsysMode: 'fail' | 'ok' = 'fail';
let xirsysHits = 0;
let xirsys: HttpServer;
let xirsysUrl = '';

let server: TestServer;
const sockets: Socket[] = [];

beforeAll(async () => {
  xirsys = createServer((req, res) => {
    xirsysHits += 1;
    if (xirsysMode === 'fail') {
      res.statusCode = 500;
      res.end('{}');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        s: 'ok',
        v: {
          iceServers: { username: 'xu', credential: 'xc', urls: ['stun:x.test', 'turn:x.test:3478?transport=udp'] },
        },
      }),
    );
  });
  await new Promise<void>((r) => xirsys.listen(0, '127.0.0.1', r));
  xirsysUrl = `http://127.0.0.1:${(xirsys.address() as AddressInfo).port}`;
  server = await startTestServer({
    callTiming: TIMING,
    ice: {
      stunUrls: ['stun:stun.test:19302'],
      xirsys: {
        ident: 'test-ident',
        secret: 'xirsys-secret-value',
        channel: 'hustalo-test',
        apiUrl: xirsysUrl,
        timeoutMs: 500,
      },
      turnFallback: { urls: ['turn:127.0.0.1:3478?transport=udp'], username: 'hustalo', credential: 'turn-pass' },
      iceTransportPolicy: 'all',
    },
  });
});
afterAll(async () => {
  await server.close();
  await new Promise<void>((r) => xirsys.close(() => r()));
});
beforeEach(async () => {
  await server.reset();
  xirsysMode = 'fail';
  xirsysHits = 0;
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});

// ---- helper ----
interface InviteAck {
  callId: string;
  status: CallStatus;
  merged: boolean;
  callType: string;
}
interface CallStateEv {
  callId: string;
  status: CallStatus;
  endReason: string | null;
  version: number;
  acceptedTabId: string | null;
  connectedAt: string | null;
}
const bearer = (u: ChatUser) => ({ Authorization: `Bearer ${u.s.accessToken}` });
const direct = async (a: ChatUser, b: ChatUser) =>
  (await server.runtime.conversations.getOrCreatePair('DIRECT', a.id, b.id)).id;

/** Tab tự ACK call:incoming (màn hình cuộc gọi đến đã hiện). */
function ringOn(sock: Socket) {
  const got: { callId: string; caller: { id: string }; ringExpiresAt: string }[] = [];
  sock.on(EVENTS.CALL_INCOMING, (p: (typeof got)[number], ack?: (r: { ok: true }) => void) => {
    got.push(p);
    ack?.({ ok: true });
  });
  return got;
}

function waitState(sock: Socket, status: CallStatus, timeoutMs = 4000): Promise<CallStateEv> {
  return new Promise((resolve, reject) => {
    const h = (p: CallStateEv) => {
      if (p.status !== status) return;
      clearTimeout(t);
      sock.off(EVENTS.CALL_STATE, h);
      resolve(p);
    };
    const t = setTimeout(() => {
      sock.off(EVENTS.CALL_STATE, h);
      reject(new Error(`Hết thời gian chờ call:state ${status}`));
    }, timeoutMs);
    sock.on(EVENTS.CALL_STATE, h);
  });
}

const ok = <D>(r: AckResponse<D>): D => {
  if (!r.ok) throw new Error(`ACK lỗi ${r.error.code}`);
  return r.data;
};
const code = (r: AckResponse<unknown>) => (r.ok ? 'OK' : r.error.code);

async function invite(u: ChatUser, conversationId: string, callType: 'VOICE' | 'VIDEO' = 'VOICE', sock = u.sock) {
  return emitAck<InviteAck>(sock, EVENTS.CALL_INVITE, { conversationId, callType });
}

const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
const cand = (n = 1) => ({
  candidate: `candidate:${n} 1 udp 1 10.0.0.${n} 5000 typ host`,
  sdpMid: '0',
  sdpMLineIndex: 0,
  usernameFragment: null,
});

/** Cuộc gọi alice → bob tới CONNECTED; trả callId. */
async function establish(alice: ChatUser, bob: ChatUser, conversationId: string) {
  ringOn(bob.sock);
  const ringing = waitState(alice.sock, 'RINGING');
  const { callId } = ok(await invite(alice, conversationId));
  await ringing;
  ok(await emitAck(bob.sock, EVENTS.CALL_ACCEPT, { callId }));
  ok(await emitAck(alice.sock, EVENTS.CALL_OFFER, { callId, revision: 1, sdp }));
  ok(await emitAck(bob.sock, EVENTS.CALL_ANSWER, { callId, revision: 1, sdp }));
  const connected = waitState(bob.sock, 'CONNECTED');
  ok(await emitAck(alice.sock, EVENTS.CALL_STATE, { callId, connectionState: 'connected' }));
  await connected;
  return callId;
}

async function systemMessages(u: ChatUser, conversationId: string): Promise<Message[]> {
  const res = await server.http().get(`/api/v1/conversations/${conversationId}/messages`).set(bearer(u));
  return (res.body as { items: Message[] }).items.filter((m) => m.type === 'SYSTEM');
}

async function unreadOf(u: ChatUser, conversationId: string): Promise<number> {
  const res = await server.http().get('/api/v1/conversations').set(bearer(u));
  return (
    (res.body as { items: { id: string; unreadCount: number }[] }).items.find((c) => c.id === conversationId)
      ?.unreadCount ?? -1
  );
}

// ==================================================================== Lua + repository (DB §4.6, §5.4)
describe('Lua cuộc gọi và callHistory (DB §5.4, §4.6)', () => {
  const ids = () => ({ a: new Types.ObjectId().toHexString(), b: new Types.ObjectId().toHexString() });
  const base = (callId: string, caller: string, callee: string, conv: string, now: number) => ({
    callId,
    callerId: caller,
    calleeId: callee,
    conversationId: conv,
    callType: 'VOICE' as const,
    callerDeviceId: randomUUID(),
    callerTabId: randomUUID(),
    nowMs: now,
    ringTimeoutMs: 45_000,
    connectTimeoutMs: 30_000,
  });

  it('TC-DB-021 call-invite.lua: CREATED, BUSY, GLARE (→ ACCEPTED, xóa RING, thêm CONNECT), CALLER_IN_CALL', async () => {
    const repo = createCallStateRepository(server.redis.client);
    const { a, b } = ids();
    const c = new Types.ObjectId().toHexString();
    const conv = new Types.ObjectId().toHexString();
    const now = Date.now();
    const c1 = new Types.ObjectId().toHexString();
    expect(await repo.invite(base(c1, a, b, conv, now))).toEqual({ result: 'CREATED', callId: c1 });
    expect(await server.redis.client.zscore(keys.callDeadlines(), `${c1}:RING`)).toBe(String(now + 45_000));
    // a gọi tiếp → a đang trong cuộc gọi
    expect((await repo.invite(base(new Types.ObjectId().toHexString(), a, c, conv, now))).result).toBe(
      'CALLER_IN_CALL',
    );
    // c gọi b (khác cặp) → BUSY
    expect(await repo.invite(base(new Types.ObjectId().toHexString(), c, b, conv, now))).toEqual({
      result: 'BUSY',
      callId: c1,
    });
    // b gọi ngược a trong cùng hội thoại khi c1 đang INITIATED → GLARE
    const glare = await repo.invite(base(new Types.ObjectId().toHexString(), b, a, conv, now));
    expect(glare).toMatchObject({ result: 'GLARE', callId: c1, version: 2, callType: 'VOICE' });
    const h = await repo.get(c1);
    expect(h?.status).toBe('ACCEPTED');
    expect(await server.redis.client.zscore(keys.callDeadlines(), `${c1}:RING`)).toBeNull();
    expect(await server.redis.client.zscore(keys.callDeadlines(), `${c1}:CONNECT`)).toBe(String(now + 30_000));
  });

  describe('TC-DB-021 điều kiện glare (DB §5.4): ngược chiều + trước khi trả lời + cuộc gọi còn sống', () => {
    const fresh = () => new Types.ObjectId().toHexString();

    it('TC-DB-021 gọi trùng cùng chiều (alice gọi bob 2 lần) → CALLER_IN_CALL, cuộc gọi đầu không đổi', async () => {
      const repo = createCallStateRepository(server.redis.client);
      const { a, b } = ids();
      const conv = fresh();
      const c1 = fresh();
      await repo.invite(base(c1, a, b, conv, Date.now()));
      expect(await repo.invite(base(fresh(), a, b, conv, Date.now()))).toEqual({
        result: 'CALLER_IN_CALL',
        callId: c1,
      });
      expect(await repo.get(c1)).toMatchObject({ status: 'INITIATED', version: 1, acceptedTabId: null });
    });

    it('TC-DB-021 cuộc gọi ngược chiều đã ACCEPTED/CONNECTED → CALLER_IN_CALL (không gộp)', async () => {
      const repo = createCallStateRepository(server.redis.client);
      const { a, b } = ids();
      const conv = fresh();
      const c1 = fresh();
      await repo.invite(base(c1, a, b, conv, Date.now()));
      for (const [from, to] of [
        ['INITIATED', 'ACCEPTED'],
        ['ACCEPTED', 'CONNECTED'],
      ] as const) {
        await repo.transition({ callId: c1, callerId: a, calleeId: b, expectedFrom: [from], to });
        expect(await repo.invite(base(fresh(), b, a, conv, Date.now()))).toEqual({
          result: 'CALLER_IN_CALL',
          callId: c1,
        });
        expect((await repo.get(c1))?.status).toBe(to);
      }
    });

    it('TC-DB-021 key "đang gọi" treo trỏ tới cuộc gọi đã kết thúc hoặc không còn → không phải glare, tạo cuộc gọi mới', async () => {
      const repo = createCallStateRepository(server.redis.client);
      const r = server.redis.client;
      for (const dead of ['ENDED', 'MISSING'] as const) {
        const { a, b } = ids();
        const conv = fresh();
        const old = fresh();
        if (dead === 'ENDED') {
          await r.hset(keys.callActive(old), {
            status: 'ENDED',
            version: 5,
            callerId: a,
            calleeId: b,
            conversationId: conv,
            callType: 'VOICE',
          });
        }
        await r.set(keys.userInCall(a), old);
        await r.set(keys.userInCall(b), old);
        const c2 = fresh();
        expect(await repo.invite(base(c2, b, a, conv, Date.now())), dead).toEqual({ result: 'CREATED', callId: c2 });
        expect(await r.get(keys.userInCall(a))).toBe(c2);
        expect(await r.get(keys.userInCall(b))).toBe(c2);
        if (dead === 'ENDED') expect((await repo.get(old))?.status).toBe('ENDED');
      }
    });

    it('TC-DB-021 khác hội thoại (cặp DIRECT và SECRET) → không gộp: CALLER_IN_CALL', async () => {
      const repo = createCallStateRepository(server.redis.client);
      const { a, b } = ids();
      const c1 = fresh();
      await repo.invite(base(c1, a, b, fresh(), Date.now()));
      expect((await repo.invite(base(fresh(), b, a, fresh(), Date.now()))).result).toBe('CALLER_IN_CALL');
    });
  });

  it('TC-DB-022 call-transition.lua: expectedFrom sai → {0, status, version} không đổi; terminal chỉ xóa user:incall khớp callId và mọi deadline', async () => {
    const repo = createCallStateRepository(server.redis.client);
    const { a, b } = ids();
    const conv = new Types.ObjectId().toHexString();
    const c1 = new Types.ObjectId().toHexString();
    await repo.invite(base(c1, a, b, conv, Date.now()));
    await repo.addDeadline(`${c1}:PEER:${randomUUID()}`, Date.now() + 10_000);
    const miss = await repo.transition({
      callId: c1,
      callerId: a,
      calleeId: b,
      expectedFrom: ['RINGING'],
      to: 'ACCEPTED',
    });
    expect(miss).toEqual({ ok: false, status: 'INITIATED', version: 1 });
    expect((await repo.get(c1))?.version).toBe(1);
    // user:incall của b đã trỏ sang cuộc gọi khác → terminal không được xóa
    await server.redis.client.set(keys.userInCall(b), 'other-call');
    const done = await repo.transition({
      callId: c1,
      callerId: a,
      calleeId: b,
      expectedFrom: ['INITIATED'],
      to: 'CANCELLED',
      fields: { endReason: 'CANCELLED' },
    });
    expect(done).toEqual({ ok: true, status: 'CANCELLED', version: 2 });
    expect(await server.redis.client.get(keys.userInCall(a))).toBeNull();
    expect(await server.redis.client.get(keys.userInCall(b))).toBe('other-call');
    const left = (await server.redis.client.zrange(keys.callDeadlines(), '0', '-1')).filter((m) => m.startsWith(c1));
    expect(left).toEqual([]);
    expect(await server.redis.client.ttl(keys.callActive(c1))).toBeLessThanOrEqual(300);
    expect(
      await repo.transition({
        callId: new Types.ObjectId().toHexString(),
        callerId: a,
        calleeId: b,
        expectedFrom: ['INITIATED'],
        to: 'RINGING',
      }),
    ).toEqual({ ok: false, missing: true });
  });

  it('TC-DB-023 call-deadlines-claim.lua gọi đồng thời từ 2 client: mỗi member chỉ trả cho đúng một client', async () => {
    const r1 = createCallStateRepository(server.redis.client);
    // Kết nối thứ hai mở ngay (client chính dùng lazyConnect + không offline queue).
    const other = server.redis.client.duplicate({ lazyConnect: false, enableOfflineQueue: true });
    const r2 = createCallStateRepository(other);
    server.runtime.calls.stop(); // sweeper của test server cũng claim cùng ZSET
    try {
      const now = Date.now();
      const members = Array.from({ length: 80 }, (_, i) => `call${i}:RING`);
      for (const m of members) await r1.addDeadline(m, now - 1);
      const [x, y] = await Promise.all([r1.claimDue(now, 50), r2.claimDue(now, 50)]);
      const [x2, y2] = await Promise.all([r1.claimDue(now, 50), r2.claimDue(now, 50)]);
      const all = [...x, ...y, ...x2, ...y2];
      expect(new Set(all).size).toBe(all.length);
      expect(new Set(all)).toEqual(new Set(members));
    } finally {
      other.disconnect();
      server.runtime.calls.start();
    }
  });

  it('TC-DB-015 finalize gọi 2 lần và gọi với version cũ: lần 2 changed=false, record không đổi; durationSec chỉ khi có connectedAt', async () => {
    const { a, b } = ids();
    const id = new Types.ObjectId();
    const createdAt = new Date();
    await callsRepository.insert({
      _id: id,
      conversationId: new Types.ObjectId(),
      callType: 'VOICE',
      callerId: new Types.ObjectId(a),
      calleeId: new Types.ObjectId(b),
      callerDeviceId: randomUUID(),
      callerTabId: randomUUID(),
      status: 'INITIATED',
      createdAt,
    });
    const connectedAt = new Date(createdAt.getTime() + 2000);
    expect((await callsRepository.update(id, { status: 'CONNECTED', version: 2, connectedAt })).changed).toBe(true);
    const endedAt = new Date(connectedAt.getTime() + 65_400);
    const first = await callsRepository.finalize(id, { status: 'ENDED', endReason: 'HANGUP', endedAt, version: 3 });
    expect(first.changed).toBe(true);
    expect(first.record.durationSec).toBe(65);
    const again = await callsRepository.finalize(id, {
      status: 'FAILED',
      endReason: 'NETWORK_FAILURE',
      endedAt: new Date(),
      version: 4,
    });
    expect(again.changed).toBe(false);
    expect(again.record).toMatchObject({ status: 'ENDED', endReason: 'HANGUP', version: 3, durationSec: 65 });
    // version cũ đến muộn
    const id2 = new Types.ObjectId();
    await callsRepository.insert({
      _id: id2,
      conversationId: new Types.ObjectId(),
      callType: 'VIDEO',
      callerId: new Types.ObjectId(a),
      calleeId: new Types.ObjectId(b),
      callerDeviceId: randomUUID(),
      callerTabId: randomUUID(),
      status: 'INITIATED',
      createdAt,
    });
    await callsRepository.update(id2, { status: 'RINGING', version: 2 });
    const stale = await callsRepository.finalize(id2, { status: 'MISSED', endReason: 'TIMEOUT', endedAt, version: 2 });
    expect(stale.changed).toBe(false);
    const missed = await callsRepository.finalize(id2, { status: 'MISSED', endReason: 'TIMEOUT', endedAt, version: 3 });
    expect(missed.record.durationSec).toBeNull();
  });
});

// ==================================================================== signaling (§7(e)–(g))
describe('mời, đổ chuông, trả lời (FR-CALL-001..005)', () => {
  it('luồng đầy đủ: INITIATED → RINGING → ACCEPTED → CONNECTING → CONNECTED → ENDED; relay chỉ tới tab bên kia; SYSTEM CALL_ENDED có thời lượng', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const incoming = ringOn(bob.sock);
    const ringingEv = new Promise<{ callId: string }>((r) => alice.sock.once(EVENTS.CALL_RINGING, r));
    const inv = ok(await invite(alice, conv, 'VIDEO'));
    expect(inv).toMatchObject({ status: 'INITIATED', merged: false, callType: 'VIDEO' });
    const { callId } = inv;
    expect((await ringingEv).callId).toBe(callId);
    expect(incoming[0]).toMatchObject({ callId, caller: { id: alice.id } });
    expect(Date.parse(incoming[0]?.ringExpiresAt ?? '')).toBeGreaterThan(Date.now());

    const accepted = new Promise<{ acceptedTabId: string }>((r) => alice.sock.once(EVENTS.CALL_ACCEPTED, r));
    expect(ok(await emitAck(bob.sock, EVENTS.CALL_ACCEPT, { callId }))).toEqual({ callId, status: 'ACCEPTED' });
    await accepted;

    const offerAtBob = new Promise<{ revision: number; sdp: string }>((r) => bob.sock.once(EVENTS.CALL_OFFER, r));
    expect(ok(await emitAck(alice.sock, EVENTS.CALL_OFFER, { callId, revision: 1, sdp }))).toEqual({ revision: 1 });
    expect(await offerAtBob).toMatchObject({ revision: 1, sdp });
    const answerAtAlice = new Promise((r) => alice.sock.once(EVENTS.CALL_ANSWER, r));
    ok(await emitAck(bob.sock, EVENTS.CALL_ANSWER, { callId, revision: 1, sdp }));
    await answerAtAlice;
    const candAtBob = new Promise<{ candidate: { candidate: string } }>((r) =>
      bob.sock.once(EVENTS.CALL_ICE_CANDIDATE, r),
    );
    ok(await emitAck(alice.sock, EVENTS.CALL_ICE_CANDIDATE, { callId, revision: 1, candidate: cand() }));
    expect((await candAtBob).candidate.candidate).toBe(cand().candidate);

    const connected = waitState(alice.sock, 'CONNECTED');
    expect(ok(await emitAck(bob.sock, EVENTS.CALL_STATE, { callId, connectionState: 'connected' }))).toMatchObject({
      status: 'CONNECTED',
    });
    expect((await connected).connectedAt).not.toBeNull();
    expect((await CallHistoryModel.findById(callId).lean())?.connectedAt).toBeInstanceOf(Date);

    await sleep(1100);
    const sysNew = new Promise<{ message: Message }>((r) => bob.sock.once(EVENTS.MESSAGE_NEW, r));
    const ended = waitState(bob.sock, 'ENDED');
    expect(ok(await emitAck(alice.sock, EVENTS.CALL_END, { callId, reason: 'HANGUP' }))).toMatchObject({
      status: 'ENDED',
      endReason: 'HANGUP',
    });
    expect((await ended).endReason).toBe('HANGUP');
    const msg = (await sysNew).message;
    expect(msg.system).toMatchObject({ kind: 'CALL_ENDED', callId, callType: 'VIDEO' });
    expect(msg.system?.durationSec).toBeGreaterThanOrEqual(1);
    expect(await server.redis.client.get(keys.userInCall(alice.id))).toBeNull();
    expect(await server.redis.client.get(keys.userInCall(bob.id))).toBeNull();
  });

  it('TC-AC-088 TC-CALL-SIG-001 callee offline: giữ INITIATED; đăng nhập trong thời gian đổ chuông → nhận call:incoming, RINGING, trả lời được', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bobU = await createUser({ username: 'bob', displayName: 'bob' });
    const conv = (await server.runtime.conversations.getOrCreatePair('DIRECT', alice.id, bobU.id)).id;
    const { callId, status } = ok(await invite(alice, conv));
    expect(status).toBe('INITIATED');
    await sleep(200); // không có socket nào của bob → không chờ ACK, vẫn INITIATED
    expect((await createCallStateRepository(server.redis.client).get(callId))?.status).toBe('INITIATED');
    const s = await login(server, bobU.email);
    const ringing = waitState(alice.sock, 'RINGING');
    // Gắn listener trước khi kết nối xong: server đẩy call:incoming ngay khi socket vào (D-08).
    const bobSock = openSocket(server.url, { token: s.accessToken, deviceId: s.deviceId });
    sockets.push(bobSock);
    const incoming = new Promise<{ callId: string }>((resolve) =>
      bobSock.on(EVENTS.CALL_INCOMING, (p: { callId: string }, ack: (r: { ok: true }) => void) => {
        ack({ ok: true });
        resolve(p);
      }),
    );
    expect((await incoming).callId).toBe(callId);
    await ringing;
    expect(code(await emitAck(bobSock, EVENTS.CALL_ACCEPT, { callId }))).toBe('OK');
  });

  it('TC-CALL-SIG-001 callee không bao giờ online → MISSED/TIMEOUT sau thời gian đổ chuông', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bobU = await createUser({ username: 'bob', displayName: 'bob' });
    const conv = (await server.runtime.conversations.getOrCreatePair('DIRECT', alice.id, bobU.id)).id;
    const missed = waitState(alice.sock, 'MISSED', TIMING.ringMs + 2000);
    ok(await invite(alice, conv));
    expect((await missed).endReason).toBe('TIMEOUT');
  });

  it('TC-AC-073 không trả lời → MISSED/TIMEOUT đúng hạn; SYSTEM CALL_MISSED tính vào unreadCount của bob, không của alice', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    ringOn(bob.sock);
    const t0 = Date.now();
    const missed = waitState(bob.sock, 'MISSED', TIMING.ringMs + 2000);
    ok(await invite(alice, conv));
    expect((await missed).endReason).toBe('TIMEOUT');
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(TIMING.ringMs - 50);
    expect(elapsed).toBeLessThan(TIMING.ringMs + 1000 + 500); // ≤ ring + 1 sweep (+ trễ test)
    await sleep(200);
    const sys = await systemMessages(bob, conv);
    expect(sys.map((m) => m.system?.kind)).toEqual(['CALL_MISSED']);
    expect(sys[0]?.senderId).toBe(alice.id);
    expect(await unreadOf(bob, conv)).toBe(1);
    expect(await unreadOf(alice, conv)).toBe(0);
  });

  it('TC-AC-074 TC-CALL-SIG-002 callee đang gọi với carol → ACK CALL_BUSY; bob nhận call:busy; ghi BUSY + SYSTEM CALL_MISSED; cuộc gọi bob–carol không đổi', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const carol = await chatUser(server, 'carol', sockets);
    const bc = await establish(carol, bob, await direct(carol, bob));
    const conv = await direct(alice, bob);
    const busyEv = new Promise<{ caller: { id: string }; callType: string }>((r) => bob.sock.once(EVENTS.CALL_BUSY, r));
    expect(code(await invite(alice, conv, 'VIDEO'))).toBe('CALL_BUSY');
    expect(await busyEv).toMatchObject({ caller: { id: alice.id }, callType: 'VIDEO' });
    const rec = await CallHistoryModel.findOne({ conversationId: conv }).lean();
    expect(rec).toMatchObject({ status: 'BUSY', endReason: 'BUSY' });
    await sleep(100);
    expect((await systemMessages(bob, conv)).map((m) => m.system?.kind)).toEqual(['CALL_MISSED']);
    expect((await createCallStateRepository(server.redis.client).get(bc))?.status).toBe('CONNECTED');
  });

  it('TC-AC-076 TC-CALL-SIG-004 TC-CALL-SIG-016 bob 2 thiết bị cùng đổ chuông; trả lời ở thiết bị 1 → thiết bị 2 nhận answered-elsewhere, accept → CALL_ALREADY_ANSWERED; offer/ICE chỉ tới thiết bị 1', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const s2 = await login(server, bob.email);
    const bob2 = await connectAs(server.url, { token: s2.accessToken, deviceId: s2.deviceId });
    sockets.push(bob2);
    const conv = await direct(alice, bob);
    const ring1 = ringOn(bob.sock);
    const ring2 = ringOn(bob2);
    const ringing = waitState(alice.sock, 'RINGING');
    const { callId } = ok(await invite(alice, conv));
    await ringing;
    expect(ring1.map((x) => x.callId)).toEqual([callId]);
    expect(ring2.map((x) => x.callId)).toEqual([callId]);
    const elsewhere = new Promise<{ reason: string }>((r) => bob2.once(EVENTS.CALL_ANSWERED_ELSEWHERE, r));
    ok(await emitAck(bob.sock, EVENTS.CALL_ACCEPT, { callId }));
    expect((await elsewhere).reason).toBe('ANSWERED_ELSEWHERE');
    expect(code(await emitAck(bob2, EVENTS.CALL_ACCEPT, { callId }))).toBe('CALL_ALREADY_ANSWERED');
    const offersAt2 = collect(bob2, EVENTS.CALL_OFFER);
    const candsAt2 = collect(bob2, EVENTS.CALL_ICE_CANDIDATE);
    const offerAt1 = new Promise((r) => bob.sock.once(EVENTS.CALL_OFFER, r));
    ok(await emitAck(alice.sock, EVENTS.CALL_OFFER, { callId, revision: 1, sdp }));
    ok(await emitAck(alice.sock, EVENTS.CALL_ICE_CANDIDATE, { callId, revision: 1, candidate: cand() }));
    await offerAt1;
    await sleep(100);
    expect(offersAt2).toHaveLength(0);
    expect(candsAt2).toHaveLength(0);
  });

  it('TC-AC-077 TC-ARCH-015 TC-CALL-SIG-003 glare: hai invite trong 50 ms → đúng một callHistory; một ACK merged=false, một merged=true ACCEPTED', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    ringOn(alice.sock);
    ringOn(bob.sock);
    const [ra, rb] = await Promise.all([invite(alice, conv, 'VIDEO'), invite(bob, conv, 'VOICE')]);
    const acks = [ok(ra), ok(rb)];
    expect(acks.map((x) => x.merged).sort()).toEqual([false, true]);
    expect(acks[0]?.callId).toBe(acks[1]?.callId);
    const merged = acks.find((x) => x.merged);
    expect(merged?.status).toBe('ACCEPTED');
    expect(await CallHistoryModel.countDocuments({ conversationId: conv })).toBe(1);
    const rec = await CallHistoryModel.findById(merged?.callId).lean();
    expect(rec?.status).toBe('ACCEPTED');
    expect(rec?.acceptedTabId).not.toBeNull();
  });

  it('TC-CALL-SIG-005 accept và cancel đến cùng lúc: CAS chọn đúng một bên; bên thua nhận trạng thái kết thúc nhất quán', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    ringOn(bob.sock);
    const ringing = waitState(alice.sock, 'RINGING');
    const { callId } = ok(await invite(alice, conv));
    await ringing;
    const [acc, can] = await Promise.all([
      emitAck(bob.sock, EVENTS.CALL_ACCEPT, { callId }),
      emitAck<{ status: CallStatus }>(alice.sock, EVENTS.CALL_CANCEL, { callId }),
    ]);
    const final = (await CallHistoryModel.findById(callId).lean())?.status;
    if (code(acc) === 'OK') {
      expect(ok(can).status).toBe('ENDED'); // cancel sau accept → HANGUP
      expect(final).toBe('ENDED');
    } else {
      expect(code(acc)).toBe('CALL_INVALID_STATE');
      expect(ok(can).status).toBe('CANCELLED');
      expect(final).toBe('CANCELLED');
    }
  });

  it('TC-CALL-SIG-004 RINGING ngay khi tab ĐẦU TIÊN ACK (tab còn lại không ACK); ringExpiresAt vẫn = lúc mời + thời gian đổ chuông', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const silent = await extraSocket(server, bob.s, sockets);
    const seenBySilent = collect(silent, EVENTS.CALL_INCOMING); // nhận nhưng không gọi ack
    const conv = await direct(alice, bob);
    ringOn(bob.sock);
    const ringingEv = new Promise<{ ringExpiresAt: string }>((r) => alice.sock.once(EVENTS.CALL_RINGING, r));
    const t0 = Date.now();
    const { callId } = ok(await invite(alice, conv));
    const ev = await ringingEv;
    expect(Date.now() - t0).toBeLessThan(TIMING.incomingAckMs - 500);
    expect(seenBySilent).toHaveLength(1);
    expect(Math.abs(Date.parse(ev.ringExpiresAt) - (t0 + TIMING.ringMs))).toBeLessThan(500);
    expect((await createCallStateRepository(server.redis.client).get(callId))?.status).toBe('RINGING');
    // hết giờ vẫn tính từ lúc mời, không từ lúc RINGING
    const missed = waitState(alice.sock, 'MISSED', TIMING.ringMs + 2000);
    await missed;
    expect(Date.now() - t0).toBeLessThan(TIMING.ringMs + 1000 + 500);
  });

  it('TC-CALL-SIG-003 TC-CALL-SIG-014 lời mời được gộp do glare không tính vào rate limit callInvite', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    ringOn(alice.sock);
    ringOn(bob.sock);
    const ringing = waitState(alice.sock, 'RINGING');
    const first = ok(await invite(alice, conv)).callId;
    await ringing;
    expect(ok(await invite(bob, conv))).toMatchObject({ callId: first, merged: true }); // glare
    ok(await emitAck(alice.sock, EVENTS.CALL_END, { callId: first, reason: 'HANGUP' }));
    // bob còn đủ 5 lượt trong cửa sổ 60 s vì lời mời gộp không bị tính
    for (let i = 0; i < 5; i += 1) {
      const { callId } = ok(await invite(bob, conv));
      ok(await emitAck(bob.sock, EVENTS.CALL_CANCEL, { callId }));
    }
    expect(code(await invite(bob, conv))).toBe('RATE_LIMITED');
  });

  it('TC-AC-072 (server) TC-CALL-SIG-015 từ chối lặp lại hoặc từ tab khác sau REJECTED → ACK REJECTED, không phát lại; từ chối cuộc gọi đã CANCELLED → CALL_INVALID_STATE', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const bob2 = await extraSocket(server, bob.s, sockets);
    const conv = await direct(alice, bob);
    ringOn(bob.sock);
    ringOn(bob2);
    const ringing = waitState(alice.sock, 'RINGING');
    const { callId } = ok(await invite(alice, conv));
    await ringing;
    const states = collect<CallStateEv>(alice.sock, EVENTS.CALL_STATE);
    expect(ok(await emitAck(bob.sock, EVENTS.CALL_REJECT, { callId }))).toEqual({ callId, status: 'REJECTED' });
    expect(ok(await emitAck(bob.sock, EVENTS.CALL_REJECT, { callId }))).toEqual({ callId, status: 'REJECTED' });
    expect(ok(await emitAck(bob2, EVENTS.CALL_REJECT, { callId }))).toEqual({ callId, status: 'REJECTED' });
    await sleep(150);
    expect(states.filter((s) => s.status === 'REJECTED')).toHaveLength(1);
    // key Redis đã hết (sau 300 s) → tra Mongo, vẫn idempotent
    await server.redis.client.del(keys.callActive(callId));
    expect(ok(await emitAck(bob2, EVENTS.CALL_REJECT, { callId }))).toEqual({ callId, status: 'REJECTED' });

    const ringing2 = waitState(alice.sock, 'RINGING');
    const second = ok(await invite(alice, conv)).callId;
    await ringing2;
    ok(await emitAck(alice.sock, EVENTS.CALL_CANCEL, { callId: second }));
    expect(code(await emitAck(bob.sock, EVENTS.CALL_REJECT, { callId: second }))).toBe('CALL_INVALID_STATE');
  });

  it('TC-AC-089 TC-CALL-SIG-006 accept sau khi MISSED → CALL_TIMEOUT', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    ringOn(bob.sock);
    const missed = waitState(bob.sock, 'MISSED', TIMING.ringMs + 2000);
    const { callId } = ok(await invite(alice, conv));
    await missed;
    expect(code(await emitAck(bob.sock, EVENTS.CALL_ACCEPT, { callId }))).toBe('CALL_TIMEOUT');
  });

  it('TC-AC-086 TC-CALL-SIG-012 gọi trong nhóm → VALIDATION_ERROR "Cuộc gọi nhóm chưa được hỗ trợ"', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const g = await server.runtime.conversations.createGroup(
      alice.id,
      { title: 'Nhóm', memberIds: [bob.id] },
      randomUUID(),
    );
    const res = await invite(alice, g.conversation.id);
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Cuộc gọi nhóm chưa được hỗ trợ' },
    });
    expect(await CallHistoryModel.countDocuments({})).toBe(0);
  });

  it('TC-AC-087 TC-CALL-SIG-013 TC-AC-014 (cuộc gọi) bị chặn hai chiều → USER_BLOCKED, không có callHistory', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    await usersService.block(alice.id, bob.id);
    expect(code(await invite(bob, conv))).toBe('USER_BLOCKED');
    expect(code(await invite(alice, conv))).toBe('USER_BLOCKED');
    expect(await CallHistoryModel.countDocuments({})).toBe(0);
  });

  it('TC-CALL-SIG-014 TC-SEC-008 lời mời thứ 6 trong 60 s → RATE_LIMITED; metric hustalo_rate_limited_total{rule=callInvite} tăng', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const before = (await metrics.rateLimited.get()).values.find((v) => v.labels.rule === 'callInvite')?.value ?? 0;
    for (let i = 0; i < 5; i += 1) {
      const { callId } = ok(await invite(alice, conv));
      ok(await emitAck(alice.sock, EVENTS.CALL_CANCEL, { callId }));
    }
    expect(code(await invite(alice, conv))).toBe('RATE_LIMITED');
    const after = (await metrics.rateLimited.get()).values.find((v) => v.labels.rule === 'callInvite')?.value ?? 0;
    expect(after).toBe(before + 1);
  });
});

// ==================================================================== quyền, replay, idempotent
describe('quyền signaling, replay, idempotent (FR-SEC-008, EC-CALL-SIG-007/010/011/015)', () => {
  it('TC-AC-083 TC-CALL-SIG-011 carol gửi signaling → CALL_NOT_FOUND; tab thứ hai của bob → FORBIDDEN; không relay tới alice', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const carol = await chatUser(server, 'carol', sockets);
    const bobTab2 = await extraSocket(server, bob.s, sockets);
    const callId = await establish(alice, bob, await direct(alice, bob));
    const relayed = [
      collect(alice.sock, EVENTS.CALL_OFFER),
      collect(alice.sock, EVENTS.CALL_ANSWER),
      collect(alice.sock, EVENTS.CALL_ICE_CANDIDATE),
    ];
    expect(code(await emitAck(carol.sock, EVENTS.CALL_OFFER, { callId, revision: 2, sdp }))).toBe('CALL_NOT_FOUND');
    expect(code(await emitAck(carol.sock, EVENTS.CALL_ICE_CANDIDATE, { callId, revision: 1, candidate: cand() }))).toBe(
      'CALL_NOT_FOUND',
    );
    expect(code(await emitAck(carol.sock, EVENTS.CALL_END, { callId, reason: 'HANGUP' }))).toBe('CALL_NOT_FOUND');
    expect(code(await emitAck(bobTab2, EVENTS.CALL_ICE_CANDIDATE, { callId, revision: 1, candidate: cand() }))).toBe(
      'FORBIDDEN',
    );
    await sleep(100);
    expect(relayed.map((r) => r.length)).toEqual([0, 0, 0]);
    expect((await createCallStateRepository(server.redis.client).get(callId))?.status).toBe('CONNECTED');
  });

  it('TC-CALL-SIG-007 TC-CALL-SIG-010 revision sai → CALL_INVALID_STATE; candidate revision cũ bị từ chối; callId cũ/không tồn tại → CALL_NOT_FOUND', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const callId = await establish(alice, bob, await direct(alice, bob));
    expect(code(await emitAck(alice.sock, EVENTS.CALL_OFFER, { callId, revision: 3, sdp }))).toBe('CALL_INVALID_STATE');
    expect(code(await emitAck(bob.sock, EVENTS.CALL_ANSWER, { callId, revision: 1, sdp }))).toBe('CALL_INVALID_STATE');
    // ICE restart → revision 2; candidate revision 1 đến muộn bị từ chối
    ok(await emitAck(alice.sock, EVENTS.CALL_ICE_RESTART, { callId, attempt: 1 }));
    ok(await emitAck(alice.sock, EVENTS.CALL_OFFER, { callId, revision: 2, sdp }));
    expect(code(await emitAck(bob.sock, EVENTS.CALL_ICE_CANDIDATE, { callId, revision: 1, candidate: cand() }))).toBe(
      'CALL_INVALID_STATE',
    );
    expect(code(await emitAck(bob.sock, EVENTS.CALL_ICE_CANDIDATE, { callId, revision: 2, candidate: cand(2) }))).toBe(
      'OK',
    );
    // replay cuộc gọi không tồn tại (cả Redis lẫn Mongo)
    const ghost = new Types.ObjectId().toHexString();
    expect(code(await emitAck(alice.sock, EVENTS.CALL_OFFER, { callId: ghost, revision: 1, sdp }))).toBe(
      'CALL_NOT_FOUND',
    );
    // cuộc gọi cũ đã hết key Redis: signaling → CALL_NOT_FOUND
    ok(await emitAck(alice.sock, EVENTS.CALL_END, { callId, reason: 'HANGUP' }));
    await server.redis.client.del(keys.callActive(callId));
    expect(
      code(await emitAck(alice.sock, EVENTS.CALL_ICE_CANDIDATE, { callId, revision: 2, candidate: cand(3) })),
    ).toBe('CALL_NOT_FOUND');
  });

  it('TC-CALL-SIG-008 candidate gửi trước khi có answer vẫn được relay (client tự xếp hàng)', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    ringOn(bob.sock);
    const ringing = waitState(alice.sock, 'RINGING');
    const { callId } = ok(await invite(alice, conv));
    await ringing;
    ok(await emitAck(bob.sock, EVENTS.CALL_ACCEPT, { callId }));
    ok(await emitAck(alice.sock, EVENTS.CALL_OFFER, { callId, revision: 1, sdp }));
    const atBob = new Promise<{ revision: number }>((r) => bob.sock.once(EVENTS.CALL_ICE_CANDIDATE, r));
    ok(await emitAck(alice.sock, EVENTS.CALL_ICE_CANDIDATE, { callId, revision: 1, candidate: cand() }));
    expect((await atBob).revision).toBe(1);
  });

  it('TC-AC-084 TC-CALL-SIG-015 call:end lặp lại sau ENDED → ACK ok với endReason gốc; không phát thêm call:state; đúng một SYSTEM', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const callId = await establish(alice, bob, conv);
    const ended = waitState(bob.sock, 'ENDED');
    ok(await emitAck(alice.sock, EVENTS.CALL_END, { callId, reason: 'HANGUP' }));
    await ended;
    const later = collect(bob.sock, EVENTS.CALL_STATE);
    expect(ok(await emitAck(alice.sock, EVENTS.CALL_END, { callId, reason: 'NETWORK_FAILURE' }))).toEqual({
      callId,
      status: 'ENDED',
      endReason: 'HANGUP',
    });
    expect(ok(await emitAck(bob.sock, EVENTS.CALL_END, { callId, reason: 'HANGUP' }))).toMatchObject({
      status: 'ENDED',
      endReason: 'HANGUP',
    });
    await sleep(150);
    expect(later).toHaveLength(0);
    expect((await systemMessages(alice, conv)).filter((m) => m.system?.kind === 'CALL_ENDED')).toHaveLength(1);
  });
});

// ==================================================================== mạng (§7(f), §8.5)
describe('mất kết nối, ICE restart, khôi phục (FR-CALL-006)', () => {
  it('TC-AC-082 TC-CALL-NET-010 CONNECTED → RECONNECTING → hết grace → ENDED/NETWORK_FAILURE; ICE restart lần 3 → CALL_INVALID_STATE', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const callId = await establish(alice, bob, await direct(alice, bob));
    const reconnecting = waitState(bob.sock, 'RECONNECTING');
    ok(await emitAck(alice.sock, EVENTS.CALL_STATE, { callId, connectionState: 'disconnected' }));
    await reconnecting;
    expect(ok(await emitAck(alice.sock, EVENTS.CALL_ICE_RESTART, { callId, attempt: 1 }))).toEqual({ attempt: 1 });
    expect(ok(await emitAck(bob.sock, EVENTS.CALL_ICE_RESTART, { callId, attempt: 2 }))).toEqual({ attempt: 2 });
    expect(code(await emitAck(alice.sock, EVENTS.CALL_ICE_RESTART, { callId, attempt: 3 }))).toBe('CALL_INVALID_STATE');
    const t0 = Date.now();
    const ended = waitState(bob.sock, 'ENDED', TIMING.reconnectMs + 2000);
    expect((await ended).endReason).toBe('NETWORK_FAILURE');
    expect(Date.now() - t0).toBeLessThan(TIMING.reconnectMs + 1000);
    expect((await CallHistoryModel.findById(callId).lean())?.iceRestarts).toBe(2);
  });

  it('TC-CALL-NET-007 hai bên báo lệch thời điểm: xử lý theo thứ tự server nhận', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const callId = await establish(alice, bob, await direct(alice, bob));
    const r = async (u: ChatUser, cs: string) =>
      ok(await emitAck<{ status: string }>(u.sock, EVENTS.CALL_STATE, { callId, connectionState: cs })).status;
    expect(await r(alice, 'disconnected')).toBe('RECONNECTING');
    expect(await r(bob, 'connected')).toBe('CONNECTED');
    expect(await r(alice, 'disconnected')).toBe('RECONNECTING');
    expect(await r(alice, 'connected')).toBe('CONNECTED');
  });

  it('TC-CALL-NET-008 một bên đã kết thúc, bên kia vẫn báo trạng thái → ACK trạng thái terminal', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const callId = await establish(alice, bob, await direct(alice, bob));
    ok(await emitAck(alice.sock, EVENTS.CALL_STATE, { callId, connectionState: 'failed' }));
    ok(await emitAck(alice.sock, EVENTS.CALL_END, { callId, reason: 'HANGUP' }));
    expect(ok(await emitAck(bob.sock, EVENTS.CALL_STATE, { callId, connectionState: 'disconnected' }))).toMatchObject({
      status: 'ENDED',
    });
  });

  it('TC-CALL-NET-009 mất state Redis giữa cuộc gọi: call:state → T29 ENDED/SERVER_RESTART (đã kết nối) hoặc FAILED (chưa kết nối)', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const callId = await establish(alice, bob, conv);
    await server.redis.client.del(keys.callActive(callId), keys.userInCall(alice.id), keys.userInCall(bob.id));
    const pushed = waitState(bob.sock, 'ENDED');
    expect(ok(await emitAck(bob.sock, EVENTS.CALL_STATE, { callId, connectionState: 'connected' }))).toMatchObject({
      status: 'ENDED',
    });
    expect((await pushed).endReason).toBe('SERVER_RESTART');
    expect(await CallHistoryModel.findById(callId).lean()).toMatchObject({
      status: 'ENDED',
      endReason: 'SERVER_RESTART',
    });
    // chưa từng kết nối → FAILED
    ringOn(bob.sock);
    const ringing = waitState(alice.sock, 'RINGING');
    const second = ok(await invite(alice, conv)).callId;
    await ringing;
    ok(await emitAck(bob.sock, EVENTS.CALL_ACCEPT, { callId: second }));
    await server.redis.client.del(keys.callActive(second));
    expect(
      ok(await emitAck(alice.sock, EVENTS.CALL_STATE, { callId: second, connectionState: 'connected' })),
    ).toMatchObject({
      status: 'FAILED',
    });
  });

  it('TC-ARCH-007 RINGING, process server chết (Redis giữ nguyên) → instance mới vẫn chốt MISSED/TIMEOUT theo deadline', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    ringOn(bob.sock);
    const ringing = waitState(alice.sock, 'RINGING');
    const { callId } = ok(await invite(alice, conv));
    await ringing;
    server.runtime.calls.stop(); // instance cũ ngừng sweeper (như process đã chết)
    const second = await server.spawnRuntime();
    try {
      await sleep(TIMING.ringMs + 600);
      expect(await CallHistoryModel.findById(callId).lean()).toMatchObject({ status: 'MISSED', endReason: 'TIMEOUT' });
    } finally {
      await second.close();
      server.runtime.calls.start();
    }
  });

  it('socket tab tham gia rớt quá grace → PEER_DISCONNECTED (T10 trước accept: CANCELLED; T26 sau kết nối: ENDED); reconnect + call:state trong grace thì giữ cuộc gọi', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    ringOn(bob.sock);
    const ringing = waitState(bob.sock, 'RINGING');
    const first = ok(await invite(alice, conv)).callId;
    await ringing;
    const cancelled = waitState(bob.sock, 'CANCELLED', TIMING.peerGraceMs + 2000);
    alice.sock.close();
    expect((await cancelled).endReason).toBe('PEER_DISCONNECTED');
    expect((await CallHistoryModel.findById(first).lean())?.status).toBe('CANCELLED');

    // tab caller rớt rồi quay lại (cùng tabId) trong grace → cuộc gọi tiếp tục
    const tabId = randomUUID();
    const a2 = await connectAs(server.url, { token: alice.s.accessToken, deviceId: alice.s.deviceId, tabId });
    sockets.push(a2);
    const aliceTab = { ...alice, sock: a2 };
    const callId = await establish(aliceTab, bob, conv);
    a2.close();
    await sleep(TIMING.peerGraceMs / 2);
    const a3 = await connectAs(server.url, { token: alice.s.accessToken, deviceId: alice.s.deviceId, tabId });
    sockets.push(a3);
    ok(await emitAck(a3, EVENTS.CALL_STATE, { callId, connectionState: 'connected' }));
    await sleep(TIMING.peerGraceMs + 300);
    expect((await createCallStateRepository(server.redis.client).get(callId))?.status).toBe('CONNECTED');
    const ended = waitState(bob.sock, 'ENDED', TIMING.peerGraceMs + 2000);
    a3.close();
    expect((await ended).endReason).toBe('PEER_DISCONNECTED');
  });
});

// ==================================================================== phiên
describe('đăng xuất / khóa tài khoản khi đang gọi (FR-AUTH-004, FR-AUTH-006)', () => {
  const logout = (u: ChatUser) =>
    server
      .http()
      .post('/api/v1/auth/logout')
      .set('Cookie', [`hustalo_rt=${u.s.refreshToken}`, `hustalo_csrf=${u.s.csrfToken}`])
      .set('X-CSRF-Token', u.s.csrfToken);

  it('TC-AC-008 TC-AUTH-007 alice đăng xuất khi CONNECTED → 204; ENDED/LOGOUT; bob nhận call:state ENDED', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const callId = await establish(alice, bob, await direct(alice, bob));
    const ended = waitState(bob.sock, 'ENDED');
    expect((await logout(alice)).status).toBe(204);
    expect((await ended).endReason).toBe('LOGOUT');
    expect(await CallHistoryModel.findById(callId).lean()).toMatchObject({ status: 'ENDED', endReason: 'LOGOUT' });
  });

  it('TC-AUTH-007 caller đăng xuất khi đang đổ chuông → CANCELLED/LOGOUT; callee đăng xuất khi đổ chuông → không đổi', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    ringOn(bob.sock);
    const ringing = waitState(alice.sock, 'RINGING');
    const { callId } = ok(await invite(alice, conv));
    await ringing;
    // bob có thiết bị thứ hai đăng xuất → cuộc gọi vẫn RINGING
    const bob2 = await login(server, bob.email);
    await server
      .http()
      .post('/api/v1/auth/logout')
      .set('Cookie', [`hustalo_rt=${bob2.refreshToken}`, `hustalo_csrf=${bob2.csrfToken}`])
      .set('X-CSRF-Token', bob2.csrfToken);
    expect((await createCallStateRepository(server.redis.client).get(callId))?.status).toBe('RINGING');
    const cancelled = waitState(bob.sock, 'CANCELLED');
    expect((await logout(alice)).status).toBe(204);
    expect((await cancelled).endReason).toBe('LOGOUT');
  });

  it('khóa tài khoản caller khi đang đổ chuông → FAILED/LOGOUT (T28)', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    ringOn(bob.sock);
    const ringing = waitState(alice.sock, 'RINGING');
    ok(await invite(alice, conv));
    await ringing;
    const failed = waitState(bob.sock, 'FAILED');
    await server.runtime.auth.lockUser(alice.email);
    expect((await failed).endReason).toBe('LOGOUT');
  });
});

// ==================================================================== REST
describe('REST /calls (FR-CALL-007, FR-CALL-008)', () => {
  it('TC-AC-091 3 cuộc gọi (đã kết nối rồi ENDED, MISSED, REJECTED) → sắp mới nhất trước, direction theo alice, durationSec chỉ cuộc đã kết nối; đúng 2 SYSTEM', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const c1 = await establish(alice, bob, conv);
    ok(await emitAck(alice.sock, EVENTS.CALL_END, { callId: c1, reason: 'HANGUP' }));
    const missed = waitState(alice.sock, 'MISSED', TIMING.ringMs + 2000);
    const c2 = ok(await invite(bob, conv)).callId; // bob gọi alice, alice không trả lời
    await missed;
    const ringing = waitState(alice.sock, 'RINGING');
    const c3 = ok(await invite(alice, conv)).callId;
    await ringing;
    ok(await emitAck(bob.sock, EVENTS.CALL_REJECT, { callId: c3 }));
    const res = await server.http().get('/api/v1/calls').set(bearer(alice));
    expect(res.status).toBe(200);
    const body = res.body as {
      items: { id: string; direction: string; status: string; durationSec: number | null; peer: { id: string } }[];
      nextCursor: string | null;
    };
    expect(body.items.map((x) => x.id)).toEqual([c3, c2, c1]);
    expect(body.items.map((x) => x.direction)).toEqual(['OUTGOING', 'INCOMING', 'OUTGOING']);
    expect(body.items.map((x) => x.status)).toEqual(['REJECTED', 'MISSED', 'ENDED']);
    expect(body.items.map((x) => x.durationSec === null)).toEqual([true, true, false]);
    expect(body.items.every((x) => x.peer.id === bob.id)).toBe(true);
    await sleep(100);
    expect((await systemMessages(alice, conv)).map((m) => m.system?.kind).sort()).toEqual([
      'CALL_ENDED',
      'CALL_MISSED',
    ]);
    // phân trang
    const p1 = await server.http().get('/api/v1/calls?limit=2').set(bearer(alice));
    const page1 = p1.body as typeof body;
    expect(page1.items).toHaveLength(2);
    const p2 = await server
      .http()
      .get(`/api/v1/calls?limit=2&cursor=${page1.nextCursor ?? ''}`)
      .set(bearer(alice));
    expect((p2.body as typeof body).items.map((x) => x.id)).toEqual([c1]);
  });

  it('TC-AC-090 TC-CALL-NET-006 Xirsys 500 → 200 source FALLBACK gồm STUN_URLS + coturn; metric fallback tăng; không lộ XIRSYS_SECRET; không cache fallback', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const before = (await metrics.iceServersFallback.get()).values.reduce((s, v) => s + v.value, 0);
    const res = await server.http().get('/api/v1/calls/ice-servers').set(bearer(alice));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as {
      iceServers: { urls: string[]; username?: string }[];
      source: string;
      iceTransportPolicy: string;
    };
    expect(body.source).toBe('FALLBACK');
    expect(body.iceTransportPolicy).toBe('all');
    expect(body.iceServers.flatMap((s) => s.urls)).toEqual([
      'stun:stun.test:19302',
      'turn:127.0.0.1:3478?transport=udp',
    ]);
    expect(JSON.stringify(res.body)).not.toContain('xirsys-secret-value');
    const after = (await metrics.iceServersFallback.get()).values.reduce((s, v) => s + v.value, 0);
    expect(after).toBe(before + 1);
    await server.http().get('/api/v1/calls/ice-servers').set(bearer(alice));
    expect(xirsysHits).toBe(2); // fallback không cache → lần 2 gọi Xirsys lại
  });

  it('TC-CALL-NET-005 Xirsys ok → source XIRSYS, expiresAt = fetchedAt + 1 h, cache 5 phút (gọi Xirsys một lần)', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    xirsysMode = 'ok';
    const t0 = Date.now();
    const res = await server.http().get('/api/v1/calls/ice-servers').set(bearer(alice));
    const body = res.body as {
      iceServers: { urls: string[]; username?: string; credential?: string }[];
      source: string;
      expiresAt: string;
    };
    expect(body.source).toBe('XIRSYS');
    expect(body.iceServers).toEqual([
      { urls: ['stun:x.test', 'turn:x.test:3478?transport=udp'], username: 'xu', credential: 'xc' },
    ]);
    const exp = Date.parse(body.expiresAt) - t0;
    expect(exp).toBeGreaterThan(3600_000 - 5000);
    expect(exp).toBeLessThanOrEqual(3600_000 + 1000);
    const again = await server.http().get('/api/v1/calls/ice-servers').set(bearer(alice));
    expect((again.body as { expiresAt: string }).expiresAt).toBe(body.expiresAt);
    expect(xirsysHits).toBe(1);
    expect(await server.redis.client.ttl(keys.iceServersXirsys())).toBeGreaterThan(290);
  });

  it('GET /calls không có token → 401; limit 51 → 400', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    expect((await server.http().get('/api/v1/calls')).status).toBe(401);
    expect((await server.http().get('/api/v1/calls?limit=51').set(bearer(alice))).status).toBe(400);
  });
});
