import { randomUUID } from 'node:crypto';
import { EVENTS } from '@hustalo/shared';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keys } from '../../infra/redis/keys';
import { chatUser, collect, emitAck, extraSocket, sleep, type ChatUser } from '../../test/chat';
import { startTestServer, type TestServer } from '../../test/factories';
import { usersService } from '../users/users.service';
import { createPresenceRepository } from './presence.repository';

// Thời gian rút ngắn tỉ lệ (thật: lease 60 s, grace 10 s, heartbeat 20 s, sweep 1 s).
const TIMING = { leaseMs: 1500, graceMs: 500, heartbeatMs: 400, sweepMs: 50 };

let server: TestServer;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = await startTestServer({ presenceTiming: TIMING });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.reset();
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});

const bearer = (u: ChatUser) => ({ Authorization: `Bearer ${u.s.accessToken}` });
const direct = async (a: ChatUser, b: ChatUser) =>
  (await server.runtime.conversations.getOrCreatePair('DIRECT', a.id, b.id)).id;
type Update = { userId: string; status: string; lastSeenAt: string | null };
type Snapshot = { users: Update[]; degraded: boolean };

async function subscribe(sock: Socket, userIds: string[]) {
  const snap = new Promise<Snapshot>((resolve) => sock.once(EVENTS.PRESENCE_SNAPSHOT, resolve));
  const ack = await emitAck<{ accepted: string[] }>(sock, EVENTS.PRESENCE_SUBSCRIBE, { userIds });
  if (!ack.ok) throw new Error(ack.error.code);
  return { accepted: ack.data.accepted, snapshot: await snap };
}

const statusOf = (snap: Snapshot, id: string) => snap.users.find((u) => u.userId === id);

describe('Lua presence-touch / presence-drop (DB Phụ lục A)', () => {
  it('TC-DB-024 hai kết nối: chỉ touch đầu trả 1; drop đầu 0, drop cuối 1; touch trong grace xóa offline-pending và trả 0', async () => {
    const repo = createPresenceRepository(server.redis.client);
    const u = 'u1';
    const t = Date.now();
    expect(await repo.touch(u, 'i:a', t, 60_000)).toBe(1);
    expect(await repo.touch(u, 'i:b', t, 60_000)).toBe(0);
    expect(await repo.drop(u, 'i:a', t, 10_000)).toBe(0);
    expect(await repo.drop(u, 'i:b', t, 10_000)).toBe(1);
    expect(await server.redis.client.zscore(keys.presenceOfflinePending(), u)).not.toBeNull();
    expect(await repo.touch(u, 'i:c', t + 1000, 60_000)).toBe(0);
    expect(await server.redis.client.zscore(keys.presenceOfflinePending(), u)).toBeNull();
  });

  it('TC-DB-025 TC-PRES-005 FLUSHDB giữa chừng → heartbeat tái tạo lease, user ONLINE lại (phát ONLINE)', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    await direct(alice, bob);
    await subscribe(bob.sock, [alice.id]);
    await server.redis.client.flushdb();
    const updates = collect<Update>(bob.sock, EVENTS.PRESENCE_UPDATE);
    await sleep(TIMING.heartbeatMs * 2);
    expect(updates.filter((x) => x.userId === alice.id && x.status === 'ONLINE').length).toBeGreaterThanOrEqual(1);
    expect(await server.redis.client.zcount(keys.presenceConns(alice.id), Date.now(), '+inf')).toBe(1);
  });
});

describe('presence đa thiết bị (FR-PRES-001, kiến trúc §7(d))', () => {
  it('TC-AC-060 TC-PRES-001 alice offline mở 2 tab gần như đồng thời → bob nhận đúng một ONLINE', async () => {
    const bob = await chatUser(server, 'bob', sockets);
    const alice = await chatUser(server, 'alice', sockets);
    await direct(alice, bob);
    alice.sock.close();
    await sleep(TIMING.graceMs + 200);
    const { snapshot } = await subscribe(bob.sock, [alice.id]);
    expect(statusOf(snapshot, alice.id)?.status).toBe('OFFLINE');
    const updates = collect<Update>(bob.sock, EVENTS.PRESENCE_UPDATE);
    await Promise.all([extraSocket(server, alice.s, sockets), extraSocket(server, alice.s, sockets)]);
    await sleep(300);
    expect(updates.filter((x) => x.userId === alice.id)).toEqual([
      expect.objectContaining({ userId: alice.id, status: 'ONLINE' }),
    ]);
  });

  it('TC-AC-027 TC-PRES-002 alice 2 tab, đóng tab 1 → bob vẫn thấy ONLINE, không nhận presence:update', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const tab2 = await extraSocket(server, alice.s, sockets);
    const bob = await chatUser(server, 'bob', sockets);
    await direct(alice, bob);
    const { snapshot } = await subscribe(bob.sock, [alice.id]);
    expect(statusOf(snapshot, alice.id)?.status).toBe('ONLINE');
    const updates = collect<Update>(bob.sock, EVENTS.PRESENCE_UPDATE);
    alice.sock.close();
    await sleep(TIMING.graceMs + TIMING.leaseMs);
    expect(updates).toEqual([]);
    expect(tab2.connected).toBe(true);
  });

  it('TC-AC-061 đóng tab rồi mở lại trong grace → không OFFLINE; đóng hẳn → OFFLINE sau grace, lastSeenAt ≈ lúc đóng', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    await direct(alice, bob);
    await subscribe(bob.sock, [alice.id]);
    const updates = collect<Update>(bob.sock, EVENTS.PRESENCE_UPDATE);

    alice.sock.close();
    await sleep(TIMING.graceMs / 2);
    const again = await extraSocket(server, alice.s, sockets);
    await sleep(TIMING.graceMs + 200);
    expect(updates).toEqual([]);

    const closedAt = Date.now();
    again.close();
    await sleep(TIMING.graceMs + 300);
    const offline = updates.filter((x) => x.status === 'OFFLINE');
    expect(offline).toHaveLength(1);
    const seen = Date.parse(offline[0]?.lastSeenAt ?? '');
    expect(Math.abs(seen - closedAt)).toBeLessThan(300);
    // lease hết hạn sau đó không phát OFFLINE lần hai (chỉ phát khi 0 ↔ ≥ 1)
    await sleep(TIMING.leaseMs + 200);
    expect(updates.filter((x) => x.status === 'OFFLINE')).toHaveLength(1);
  });

  it('TC-AC-062 TC-PRES-003 client/instance chết (lease không được gia hạn, không có disconnect) → OFFLINE ≤ lease', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    await direct(alice, bob);
    alice.sock.close();
    await sleep(TIMING.graceMs + 200);
    await subscribe(bob.sock, [alice.id]);
    const updates = collect<Update>(bob.sock, EVENTS.PRESENCE_UPDATE);
    // Lease của một instance khác đã chết: không ai gia hạn, không có drop.
    const repo = createPresenceRepository(server.redis.client);
    expect(await repo.touch(alice.id, `dead:${randomUUID()}`, Date.now(), TIMING.leaseMs)).toBe(1);
    // touch trực tiếp không đi qua service nên không phát ONLINE; chờ lease hết hạn
    await sleep(TIMING.leaseMs + 300);
    expect(updates.filter((x) => x.userId === alice.id && x.status === 'OFFLINE')).toHaveLength(1);
  });
});

describe('presence:subscribe và quyền riêng tư (FR-PRES-002/003, FR-USER-004)', () => {
  it('TC-AC-063 chỉ chấp nhận người có chung hội thoại và không chặn hai chiều', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const carol = await chatUser(server, 'carol', sockets);
    const frank = await chatUser(server, 'frank', sockets);
    await direct(alice, bob);
    await server
      .http()
      .post('/api/v1/conversations')
      .set(bearer(alice))
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'GROUP', title: 'G', memberIds: [carol.id] });
    await server.http().post(`/api/v1/users/${alice.id}/block`).set(bearer(bob));
    const { accepted, snapshot } = await subscribe(alice.sock, [bob.id, carol.id, frank.id]);
    expect(accepted).toEqual([carol.id]);
    expect(snapshot.users.map((u) => u.userId)).toEqual([carol.id]);
    expect(snapshot.degraded).toBe(false);
  });

  it('TC-AC-016 TC-PRES-004 bob ẩn lastSeen → alice nhận lastSeenAt null của bob và bob nhận null của alice (có đi có lại)', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    await direct(alice, bob);
    await server
      .http()
      .patch('/api/v1/users/me')
      .set(bearer(bob))
      .send({ privacy: { showLastSeen: false } });
    const past = new Date(Date.now() - 3_600_000);
    await Promise.all([usersService.setLastSeen(alice.id, past), usersService.setLastSeen(bob.id, past)]);

    // bob offline: alice thấy OFFLINE nhưng lastSeenAt null
    bob.sock.close();
    await sleep(TIMING.graceMs + 200);
    const a = await subscribe(alice.sock, [bob.id]);
    expect(statusOf(a.snapshot, bob.id)).toEqual({ userId: bob.id, status: 'OFFLINE', lastSeenAt: null });

    // bob online lại, alice offline: bob nhận null cho alice (snapshot và update)
    const bobAgain = await extraSocket(server, bob.s, sockets);
    const b = await subscribe(bobAgain, [alice.id]);
    expect(statusOf(b.snapshot, alice.id)?.status).toBe('ONLINE');
    const toBob = collect<Update>(bobAgain, EVENTS.PRESENCE_UPDATE);
    alice.sock.close();
    await sleep(TIMING.graceMs + 300);
    const off = toBob.filter((x) => x.userId === alice.id && x.status === 'OFFLINE');
    expect(off).toHaveLength(1);
    expect(off[0]?.lastSeenAt).toBeNull();
  });

  it('người xem bật lastSeen, chủ thể bật lastSeen → OFFLINE kèm lastSeenAt', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    await direct(alice, bob);
    await subscribe(bob.sock, [alice.id]);
    const updates = collect<Update>(bob.sock, EVENTS.PRESENCE_UPDATE);
    alice.sock.close();
    await sleep(TIMING.graceMs + 300);
    expect(updates.find((x) => x.status === 'OFFLINE')?.lastSeenAt).toEqual(expect.any(String));
  });
});

describe('typing (FR-CHAT-005)', () => {
  it('typing:start → typing:update true tới người khác (không tới người gõ); typing:stop → false; join trả typingUserIds', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const toBob = collect<{ conversationId: string; userId: string; isTyping: boolean }>(
      bob.sock,
      EVENTS.TYPING_UPDATE,
    );
    const toAlice = collect(alice.sock, EVENTS.TYPING_UPDATE);
    expect((await emitAck(alice.sock, EVENTS.TYPING_START, { conversationId: conv })).ok).toBe(true);
    const join = await emitAck<{ typingUserIds: string[] }>(bob.sock, EVENTS.CONVERSATION_JOIN, {
      conversationId: conv,
    });
    expect(join.ok && join.data.typingUserIds).toEqual([alice.id]);
    expect((await emitAck(alice.sock, EVENTS.TYPING_STOP, { conversationId: conv })).ok).toBe(true);
    await sleep(100);
    expect(toBob).toEqual([
      expect.objectContaining({ conversationId: conv, userId: alice.id, isTyping: true }),
      expect.objectContaining({ conversationId: conv, userId: alice.id, isTyping: false }),
    ]);
    expect(toAlice).toEqual([]);
  });

  it('TC-AC-014 (typing) bị chặn → typing:start USER_BLOCKED; không phải thành viên → NOT_FOUND', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const carol = await chatUser(server, 'carol', sockets);
    const conv = await direct(alice, bob);
    await server.http().post(`/api/v1/users/${bob.id}/block`).set(bearer(alice));
    expect(await emitAck(bob.sock, EVENTS.TYPING_START, { conversationId: conv })).toMatchObject({
      ok: false,
      error: { code: 'USER_BLOCKED' },
    });
    expect(await emitAck(carol.sock, EVENTS.TYPING_START, { conversationId: conv })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
