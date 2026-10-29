import { randomUUID } from 'node:crypto';
import {
  EVENTS,
  MESSAGE_EDIT_WINDOW_MS,
  encodeCursor,
  type ConversationPage,
  type ErrorResponse,
  type Message,
  type MessagePage,
} from '@hustalo/shared';
import mongoose, { Types } from 'mongoose';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptField } from '../../infra/crypto/aes-gcm';
import { toAppError } from '../../http/middleware/error-handler';
import { chatUser, collect, emitAck, sleep, type ChatUser } from '../../test/chat';
import { startTestServer, type TestServer } from '../../test/factories';
import { connectAs, waitFor } from '../../test/socket-client';
import { MessageModel } from './message.model';
import { MessageReceiptModel } from './messageReceipt.model';

let server: TestServer;
const sockets: Socket[] = [];

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
  for (const s of sockets.splice(0)) s.close();
});

const bearer = (u: ChatUser) => ({ Authorization: `Bearer ${u.s.accessToken}` });
const errorOf = (res: { body: unknown }) => (res.body as ErrorResponse).error;
type SendAck = { message: Message; duplicate: boolean };
const send = (u: ChatUser, conversationId: string, content: string, clientMessageId: string = randomUUID()) =>
  emitAck<SendAck>(u.sock, EVENTS.MESSAGE_SEND, { kind: 'PLAINTEXT', conversationId, clientMessageId, content });

async function sendOk(u: ChatUser, conversationId: string, content: string) {
  const res = await send(u, conversationId, content);
  if (!res.ok) throw new Error(`gửi thất bại: ${res.error.code}`);
  return res.data.message;
}

async function direct(a: ChatUser, b: ChatUser) {
  return (await server.runtime.conversations.getOrCreatePair('DIRECT', a.id, b.id)).id;
}

const history = (u: ChatUser, convId: string, query: Record<string, string | number> = {}) =>
  server.http().get(`/api/v1/conversations/${convId}/messages`).query(query).set(bearer(u));

describe('message:send (FR-CHAT-002)', () => {
  it('TC-AC-020 TC-ARCH-006 ACK ok ≤ 300 ms, đã commit khi ACK; bob nhận message:new với senderId và createdAt server', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const incoming = waitFor<{ message: Message }>(bob.sock, EVENTS.MESSAGE_NEW);
    const before = Date.now();
    const started = performance.now();
    const res = await send(alice, conv, 'Xin chào');
    expect(performance.now() - started).toBeLessThanOrEqual(300);
    expect(res).toMatchObject({
      ok: true,
      data: { duplicate: false, message: { content: 'Xin chào', sender: { id: alice.id } } },
    });
    if (!res.ok) return;
    // Đọc từ kết nối khác ngay sau ACK: đã commit (AC-ARCH-006)
    const other = await mongoose.createConnection(process.env.MONGODB_URI ?? '').asPromise();
    try {
      const doc = await other.collection('messages').findOne({ _id: new Types.ObjectId(res.data.message.id) });
      expect(doc).not.toBeNull();
    } finally {
      await other.close();
    }
    const got = await incoming;
    expect(got.message).toMatchObject({
      id: res.data.message.id,
      senderId: alice.id,
      content: 'Xin chào',
      receipt: null,
    });
    expect(Date.parse(got.message.createdAt)).toBeGreaterThanOrEqual(before - 5);
    // Người gửi thấy receipt chưa nhận / chưa đọc (DIRECT)
    expect(res.data.message.receipt).toEqual({ deliveredAt: null, readAt: null });
  });

  it('TC-ARCH-005 DB không có nội dung rõ; contentEnc {v, keyId, iv 12 byte, ct, tag}; AAD sai → giải mã thất bại', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const m = await sendOk(alice, conv, 'bí mật 123');
    const raw = await MessageModel.collection.findOne({ _id: new Types.ObjectId(m.id) });
    expect(JSON.stringify(raw)).not.toContain('bí mật 123');
    expect(raw).not.toHaveProperty('content');
    const enc = raw?.contentEnc as { v: 1; keyId: string; iv: string; ct: string; tag: string };
    expect(enc).toMatchObject({ v: 1, keyId: 'ktest1' });
    expect(Buffer.from(enc.iv, 'base64')).toHaveLength(12);
    expect(decryptField(enc, `${conv}:${m.id}`)).toBe('bí mật 123');
    expect(() => decryptField(enc, `${new Types.ObjectId().toHexString()}:${m.id}`)).toThrow();
  });

  it('TC-AC-021 TC-NET-004 TC-DB-006 cùng clientMessageId (lặp và song song) → 1 tin, duplicate: true cùng id, 1 receipt', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const newOnBob = collect(bob.sock, EVENTS.MESSAGE_NEW);
    const cid = randomUUID();
    const [a, b] = await Promise.all([send(alice, conv, 'một lần', cid), send(alice, conv, 'một lần', cid)]);
    const again = await send(alice, conv, 'một lần', cid);
    const results = [a, b, again].map((r) => (r.ok ? r.data : null));
    expect(new Set(results.map((r) => r?.message.id)).size).toBe(1);
    expect(results.filter((r) => r?.duplicate === false)).toHaveLength(1);
    expect(await MessageModel.countDocuments({ conversationId: conv })).toBe(1);
    expect(await MessageReceiptModel.countDocuments({ conversationId: conv })).toBe(1);
    await sleep(200);
    expect(newOnBob).toHaveLength(1);
  });

  it('TC-AC-035 TC-AC-036 TC-MSG-005 TC-MSG-006 TC-MSG-016 payload sai → VALIDATION_ERROR qua socket', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    for (const content of ['', '   ', '​​', '\n\t', `${'👨‍👩‍👧'.repeat(800)}a`]) {
      expect(await send(alice, conv, content)).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    }
    expect(await send(alice, conv, '👨‍👩‍👧'.repeat(800))).toMatchObject({ ok: true });
    const base = { kind: 'PLAINTEXT', conversationId: conv, clientMessageId: randomUUID(), content: 'x' };
    for (const payload of [
      { ...base, senderId: alice.id },
      { ...base, createdAt: new Date().toISOString() },
      { ...base, clientMessageId: 'không-phải-uuid' },
      { ...base, ciphertext: { v: 1, senderDeviceId: randomUUID(), recipients: [] } },
      {
        kind: 'E2EE',
        conversationId: conv,
        clientMessageId: randomUUID(),
        ciphertext: {
          v: 1,
          senderDeviceId: randomUUID(),
          recipients: [{ deviceId: randomUUID(), type: 1, body: 'QUJD' }],
        },
      },
    ]) {
      expect(await emitAck(alice.sock, EVENTS.MESSAGE_SEND, payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_ERROR' },
      });
    }
  });

  it('TC-AC-029 người ngoài hội thoại: socket NOT_FOUND; REST lịch sử 404 giống id không tồn tại', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const carol = await chatUser(server, 'carol', sockets);
    const conv = await direct(alice, bob);
    expect(await send(carol, conv, 'xin chào')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const real = await history(carol, conv);
    const fake = await history(carol, new Types.ObjectId().toHexString());
    expect([real.status, fake.status]).toEqual([404, 404]);
    expect({ ...errorOf(real), requestId: '' }).toEqual({ ...errorOf(fake), requestId: '' });
  });

  it('TC-DB-005 bất biến messages: SYSTEM có contentEnc, TEXT chưa thu hồi không body, có cả contentEnc và ciphertext → lỗi', async () => {
    const base = { conversationId: new Types.ObjectId(), senderId: new Types.ObjectId(), createdAt: new Date() };
    const enc = { v: 1, keyId: 'ktest1', iv: 'AAAAAAAAAAAAAAAA', ct: 'AA==', tag: 'AAAAAAAAAAAAAAAAAAAAAA==' };
    const sys = { kind: 'GROUP_CREATED', actorId: base.senderId };
    await expect(MessageModel.create({ ...base, type: 'SYSTEM', system: sys, contentEnc: enc })).rejects.toThrow();
    await expect(MessageModel.create({ ...base, type: 'TEXT', clientMessageId: randomUUID() })).rejects.toThrow();
    const envelope = {
      v: 1,
      senderDeviceId: randomUUID(),
      recipients: [{ deviceId: randomUUID(), type: 1, body: 'QUJD' }],
    };
    await expect(
      MessageModel.create({
        ...base,
        type: 'TEXT',
        clientMessageId: randomUUID(),
        contentEnc: enc,
        ciphertext: envelope,
      }),
    ).rejects.toThrow();
  });

  it('TC-NET-010 kết nối bằng HTTP long-polling vẫn gửi/nhận được', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const polling = io(server.url, {
      path: '/socket.io',
      transports: ['polling'],
      reconnection: false,
      forceNew: true,
      auth: { token: bob.s.accessToken, deviceId: bob.s.deviceId, tabId: randomUUID() },
    });
    sockets.push(polling);
    await new Promise<void>((resolve, reject) => {
      polling.once('connect', () => resolve());
      polling.once('connect_error', reject);
    });
    expect(polling.io.engine.transport.name).toBe('polling');
    const incoming = waitFor<{ message: Message }>(polling, EVENTS.MESSAGE_NEW);
    await sendOk(alice, conv, 'qua polling');
    expect((await incoming).message.content).toBe('qua polling');
  });

  it('TC-INFRA-001 Mongo không truy cập được → SERVICE_UNAVAILABLE (REST 503 / ACK)', () => {
    const err = toAppError(new mongoose.mongo.MongoNetworkError('connection refused'));
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.status).toBe(503);
  });
});

describe('chặn trong 1-1 (FR-USER-003)', () => {
  it('TC-AC-014 TC-MSG-011 alice chặn bob: cả hai gửi → USER_BLOCKED; summary bob canMessage false, alice blockedByMe', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    await sendOk(alice, conv, 'trước khi chặn');
    await server.http().post(`/api/v1/users/${bob.id}/block`).set(bearer(alice));
    expect(await send(bob, conv, 'hi')).toMatchObject({ ok: false, error: { code: 'USER_BLOCKED' } });
    expect(await send(alice, conv, 'hi')).toMatchObject({ ok: false, error: { code: 'USER_BLOCKED' } });
    const list = async (u: ChatUser) =>
      ((await server.http().get('/api/v1/conversations').set(bearer(u))).body as ConversationPage).items[0];
    expect(await list(bob)).toMatchObject({ canMessage: false, blockedByMe: false });
    expect(await list(alice)).toMatchObject({ canMessage: false, blockedByMe: true });
  });

  it('TC-AC-015 bỏ chặn → gửi được; POST/DELETE block lặp lại vẫn 204; GET /users/blocked liệt kê đúng', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const block = () => server.http().post(`/api/v1/users/${bob.id}/block`).set(bearer(alice));
    const unblock = () => server.http().delete(`/api/v1/users/${bob.id}/block`).set(bearer(alice));
    expect([(await block()).status, (await block()).status]).toEqual([204, 204]);
    const blocked = await server.http().get('/api/v1/users/blocked').set(bearer(alice));
    expect(blocked.body).toEqual({ items: [{ id: bob.id, username: 'bob', displayName: 'bob', avatarUrl: null }] });
    expect([(await unblock()).status, (await unblock()).status]).toEqual([204, 204]);
    expect(await send(bob, conv, 'đã bỏ chặn')).toMatchObject({ ok: true });
  });
});

describe('lịch sử cursor (FR-CHAT-003)', () => {
  it('TC-AC-037 TC-DB-009 250 tin (nhiều tin cùng mili-giây): duyệt before và after đủ, không trùng, tăng dần, không SKIP', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const t0 = Date.now() - 60_000;
    await MessageModel.insertMany(
      Array.from({ length: 250 }, (_, i) => ({
        conversationId: conv,
        senderId: alice.id,
        type: 'SYSTEM',
        system: { kind: 'GROUP_CREATED', actorId: alice.id },
        createdAt: new Date(t0 + Math.floor(i / 5)), // 5 tin cùng mili-giây
      })),
    );
    const all = (await MessageModel.find({ conversationId: conv }).sort({ createdAt: 1, _id: 1 }).lean()).map((m) =>
      String(m._id),
    );

    const backward: string[] = [];
    let before: string | null = null;
    do {
      const page = (await history(alice, conv, before ? { before } : {})).body as MessagePage;
      backward.unshift(...page.items.map((m) => m.id));
      if (!before) expect(page.nextAfter).toBeNull();
      before = page.nextBefore;
    } while (before);
    expect(backward).toEqual(all);

    const forward: string[] = [];
    let after: string | null = encodeCursor({ createdAt: new Date(t0 - 1).toISOString(), id: '0'.repeat(24) });
    while (after) {
      const page = (await history(alice, conv, { after, limit: 100 })).body as MessagePage;
      forward.push(...page.items.map((m) => m.id));
      after = page.nextAfter;
    }
    expect(forward).toEqual(all);

    const plan = JSON.stringify(
      await MessageModel.find({ conversationId: conv }).sort({ createdAt: -1, _id: -1 }).limit(31).explain(),
    );
    expect(plan).toContain('conv_created_id');
    expect(plan).not.toContain('"SKIP"');
    const someCursor = encodeCursor({ createdAt: new Date(t0).toISOString(), id: all[0] ?? '' });
    expect((await history(alice, conv, { limit: 101 })).status).toBe(400);
    expect((await history(alice, conv, { before: someCursor, after: someCursor })).status).toBe(400);
    expect((await history(alice, conv, { before: 'khong-hop-le' })).status).toBe(400);
  });
});

describe('sửa / thu hồi (FR-CHAT-007/008)', () => {
  it('TC-AC-030 sửa trong 15 phút → mọi người nhận message:edit có editedAt; IV mới; nội dung y hệt → không phát event', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const m = await sendOk(alice, conv, 'Nội dung cũ');
    const ivOf = async () =>
      (await MessageModel.findById(m.id).lean<{ contentEnc: { iv: string } | null }>())?.contentEnc?.iv;
    const oldIv = await ivOf();
    const edited = waitFor<{ message: Message }>(bob.sock, EVENTS.MESSAGE_EDIT);
    const res = await emitAck<{ message: Message }>(alice.sock, EVENTS.MESSAGE_EDIT, {
      messageId: m.id,
      content: 'Nội dung mới',
    });
    expect(res).toMatchObject({ ok: true, data: { message: { content: 'Nội dung mới' } } });
    const ev = await edited;
    expect(ev.message.content).toBe('Nội dung mới');
    expect(ev.message.editedAt).not.toBeNull();
    expect(await ivOf()).not.toBe(oldIv);
    const more = collect(bob.sock, EVENTS.MESSAGE_EDIT);
    expect(await emitAck(alice.sock, EVENTS.MESSAGE_EDIT, { messageId: m.id, content: 'Nội dung mới' })).toMatchObject({
      ok: true,
    });
    await sleep(200);
    expect(more).toEqual([]);
  });

  it('TC-AC-031 TC-MSG-015 tin 16 phút trước (giờ server): alice sửa, alice thu hồi, bob sửa → đều FORBIDDEN, tin không đổi', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const m = await sendOk(alice, conv, 'cũ');
    await MessageModel.updateOne(
      { _id: m.id },
      { $set: { createdAt: new Date(Date.now() - MESSAGE_EDIT_WINDOW_MS - 60_000) } },
    );
    for (const [u, ev, p] of [
      [alice, EVENTS.MESSAGE_EDIT, { messageId: m.id, content: 'mới' }],
      [alice, EVENTS.MESSAGE_DELETE, { messageId: m.id }],
      [bob, EVENTS.MESSAGE_EDIT, { messageId: m.id, content: 'mới' }],
    ] as const) {
      expect(await emitAck(u.sock, ev, p)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    const doc = await MessageModel.findById(m.id).lean();
    expect(doc?.deletedAt).toBeNull();
    expect(doc?.editedAt).toBeNull();
  });

  it('TC-AC-032 thu hồi tin cuối → event, DB không còn contentEnc, preview thu hồi; lặp lại → ok, không event', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const m = await sendOk(alice, conv, 'sẽ thu hồi');
    const deleted = waitFor<{ message: Message }>(bob.sock, EVENTS.MESSAGE_DELETE);
    const first = await emitAck<{ message: Message }>(alice.sock, EVENTS.MESSAGE_DELETE, { messageId: m.id });
    expect(first).toMatchObject({ ok: true, data: { message: { content: null } } });
    const ev = await deleted;
    expect(ev.message.deletedAt).not.toBeNull();
    expect((await MessageModel.findById(m.id).lean())?.contentEnc).toBeNull();
    const list = (await server.http().get('/api/v1/conversations').set(bearer(bob))).body as ConversationPage;
    expect(list.items[0]?.lastMessage).toMatchObject({ id: m.id, preview: null });
    expect(list.items[0]?.lastMessage?.deletedAt).not.toBeNull();
    const more = collect(bob.sock, EVENTS.MESSAGE_DELETE);
    const second = await emitAck<{ message: Message }>(alice.sock, EVENTS.MESSAGE_DELETE, { messageId: m.id });
    expect(second.ok && second.data.message.deletedAt).toBe(first.ok && first.data.message.deletedAt);
    await sleep(200);
    expect(more).toEqual([]);
  });
});

describe('nhóm và quyền (FR-GROUP-003, FR-SEC-008)', () => {
  async function groupOf(owner: ChatUser, members: ChatUser[]) {
    const res = await server
      .http()
      .post('/api/v1/conversations')
      .set(bearer(owner))
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'GROUP', title: 'G', memberIds: members.map((m) => m.id) });
    return (res.body as { conversation: { id: string } }).conversation.id;
  }

  it('TC-AC-034 TC-AC-057 TC-GROUP-007 TC-MSG-010 carol bị xóa: REST 403, join/send NOT_A_MEMBER, không còn nhận message:new', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const carol = await chatUser(server, 'carol', sockets);
    const g = await groupOf(alice, [bob, carol]);
    await emitAck(carol.sock, EVENTS.CONVERSATION_JOIN, { conversationId: g });
    const carolNew = collect(carol.sock, EVENTS.MESSAGE_NEW);
    const removed = waitFor(carol.sock, EVENTS.CONVERSATION_MEMBER_REMOVED);
    await server.http().delete(`/api/v1/conversations/${g}/members/${carol.id}`).set(bearer(alice));
    await removed;

    const rest = await server.http().get(`/api/v1/conversations/${g}`).set(bearer(carol));
    expect(rest.status).toBe(403);
    expect(errorOf(rest).code).toBe('NOT_A_MEMBER');
    expect(await emitAck(carol.sock, EVENTS.CONVERSATION_JOIN, { conversationId: g })).toMatchObject({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
    expect(await send(carol, g, 'còn ở đây không?')).toMatchObject({ ok: false, error: { code: 'NOT_A_MEMBER' } });
    await sendOk(bob, g, 'tin mới trong G');
    await sleep(200);
    expect(carolNew).toEqual([]);
  });

  it('TC-SEC-002 join room không có quyền → NOT_FOUND; không nhận message:new của hội thoại đó', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const mallory = await chatUser(server, 'mallory', sockets);
    const conv = await direct(alice, bob);
    expect(await emitAck(mallory.sock, EVENTS.CONVERSATION_JOIN, { conversationId: conv })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    const got = collect(mallory.sock, EVENTS.MESSAGE_NEW);
    await sendOk(alice, conv, 'riêng tư');
    await sleep(200);
    expect(got).toEqual([]);
  });
});

describe('khởi động lại server (EC-NET-003)', () => {
  it('TC-NET-003 tin đã ACK còn sau khi server khởi động lại; socket mới kết nối với recovered = false và lịch sử đủ', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const m = await sendOk(alice, conv, 'trước khi restart');
    await server.close();
    server = await startTestServer();
    const sock = await connectAs(server.url, { token: bob.s.accessToken, deviceId: bob.s.deviceId });
    sockets.push(sock);
    expect(sock.recovered).toBe(false);
    const page = (await history(bob, conv)).body as MessagePage;
    expect(page.items.map((x) => x.id)).toEqual([m.id]);
  });
});
