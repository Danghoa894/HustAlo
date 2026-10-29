import { randomUUID } from 'node:crypto';
import { EVENTS, type ConversationPage, type Message } from '@hustalo/shared';
import { Types } from 'mongoose';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chatUser, collect, emitAck, extraSocket, sleep, type ChatUser } from '../../test/chat';
import { startTestServer, type TestServer } from '../../test/factories';
import { waitFor } from '../../test/socket-client';
import { messagesCore } from './messages.service';
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
type StatusEvent = {
  scope: string;
  messageIds?: string[];
  status?: string;
  byUserId?: string;
  userId?: string;
  lastReadMessageId?: string | null;
};

async function sendOk(u: ChatUser, conversationId: string, content: string): Promise<Message> {
  const res = await emitAck<{ message: Message }>(u.sock, EVENTS.MESSAGE_SEND, {
    kind: 'PLAINTEXT',
    conversationId,
    clientMessageId: randomUUID(),
    content,
  });
  if (!res.ok) throw new Error(res.error.code);
  return res.data.message;
}

const direct = async (a: ChatUser, b: ChatUser) =>
  (await server.runtime.conversations.getOrCreatePair('DIRECT', a.id, b.id)).id;

const receipt = (convId: string, upToMessageId: string) => ({ conversationId: convId, upToMessageId });

describe('receipt DIRECT (FR-CHAT-004, DB §4.5)', () => {
  it('TC-AC-022 TC-AC-023 delivered tới mốc → alice nhận message:status DELIVERED cho mọi tin chưa nhận', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const ms = [await sendOk(alice, conv, '1'), await sendOk(alice, conv, '2'), await sendOk(alice, conv, '3')];
    const status = waitFor<StatusEvent>(alice.sock, EVENTS.MESSAGE_STATUS);
    const res = await emitAck(bob.sock, EVENTS.MESSAGE_DELIVERED, receipt(conv, ms[2]?.id ?? ''));
    expect(res).toMatchObject({ ok: true, data: { advanced: true } });
    const ev = await status;
    expect(ev).toMatchObject({ scope: 'MESSAGE', status: 'DELIVERED', byUserId: bob.id });
    expect([...(ev.messageIds ?? [])].sort()).toEqual(ms.map((m) => m.id).sort());
  });

  it('TC-AC-024 TC-AC-043 TC-MSG-014 read → READ tới người gửi và các device khác của người đọc; unreadCount = 0', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const bob2 = await extraSocket(server, bob.s, sockets);
    const conv = await direct(alice, bob);
    const ms = [];
    for (const t of ['1', '2', '3', '4', '5']) ms.push(await sendOk(alice, conv, t));
    const toAlice = waitFor<StatusEvent>(alice.sock, EVENTS.MESSAGE_STATUS);
    const toBob2 = waitFor<StatusEvent>(bob2, EVENTS.MESSAGE_STATUS);
    const res = await emitAck(bob.sock, EVENTS.MESSAGE_READ, receipt(conv, ms[4]?.id ?? ''));
    expect(res).toMatchObject({ ok: true, data: { advanced: true, unreadCount: 0 } });
    expect(await toAlice).toMatchObject({ status: 'READ', byUserId: bob.id });
    expect((await toBob2).messageIds).toHaveLength(5);
    const page = (await server.http().get('/api/v1/conversations').set(bearer(bob))).body as ConversationPage;
    expect(page.items[0]?.unreadCount).toBe(0);
  });

  it('TC-AC-025 delivered đến muộn cho tin đã READ → advanced: false, không phát message:status, không hạ cấp', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const m = await sendOk(alice, conv, 'đã đọc');
    await emitAck(bob.sock, EVENTS.MESSAGE_READ, receipt(conv, m.id));
    const got = collect(alice.sock, EVENTS.MESSAGE_STATUS);
    expect(await emitAck(bob.sock, EVENTS.MESSAGE_DELIVERED, receipt(conv, m.id))).toMatchObject({
      ok: true,
      data: { advanced: false },
    });
    await sleep(200);
    expect(got).toEqual([]);
    const r = await MessageReceiptModel.findOne({ messageId: m.id }).lean();
    expect(r?.readAt).not.toBeNull();
  });

  it('TC-SEC-003 receipt kèm userId → VALIDATION_ERROR; upToMessageId không thuộc hội thoại → NOT_FOUND', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const m = await sendOk(alice, conv, 'x');
    expect(await emitAck(bob.sock, EVENTS.MESSAGE_READ, { ...receipt(conv, m.id), userId: alice.id })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(
      await emitAck(bob.sock, EVENTS.MESSAGE_READ, receipt(conv, new Types.ObjectId().toHexString())),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const rest = await server
      .http()
      .post(`/api/v1/conversations/${conv}/read`)
      .set(bearer(bob))
      .send({ upToMessageId: m.id, userId: alice.id });
    expect(rest.status).toBe(400);
  });

  it('TC-DB-010 advanceCursors: cũ hơn / bằng → không đổi; mới hơn → tiến; không bao giờ lùi', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = new Types.ObjectId(await direct(alice, bob));
    const svc = server.runtime.conversations;
    const t = new Date();
    const mid = { at: t, id: new Types.ObjectId() };
    expect(await svc.advanceCursors(conv, bob.id, mid, ['Read'])).toEqual(['Read']);
    expect(await svc.advanceCursors(conv, bob.id, mid, ['Read'])).toEqual([]);
    expect(
      await svc.advanceCursors(conv, bob.id, { at: new Date(t.getTime() - 1), id: new Types.ObjectId() }, ['Read']),
    ).toEqual([]);
    const newer = { at: t, id: new Types.ObjectId() }; // cùng thời điểm, _id lớn hơn
    expect(await svc.advanceCursors(conv, bob.id, newer, ['Read'])).toEqual(['Read']);
    expect((await svc.memberCursors(conv, bob.id)).read?.id.equals(newer.id)).toBe(true);
  });

  it('TC-DB-011 markRead DIRECT: receipt ≤ mốc có readAt và deliveredAt; receipt đã READ giữ nguyên readAt cũ', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = await direct(alice, bob);
    const a = await sendOk(alice, conv, 'a');
    await emitAck(bob.sock, EVENTS.MESSAGE_READ, receipt(conv, a.id));
    const firstRead = (await MessageReceiptModel.findOne({ messageId: a.id }).lean<{ readAt: Date | null }>())?.readAt;
    await sleep(20);
    const b = await sendOk(alice, conv, 'b');
    await emitAck(bob.sock, EVENTS.MESSAGE_READ, receipt(conv, b.id));
    const rows = await MessageReceiptModel.find({ conversationId: conv }).lean<
      { messageId: Types.ObjectId; readAt: Date | null; deliveredAt: Date | null }[]
    >();
    expect(rows.every((r) => r.readAt && r.deliveredAt)).toBe(true);
    expect(rows.find((r) => String(r.messageId) === a.id)?.readAt?.getTime()).toBe(firstRead?.getTime());
  });
});

describe('số chưa đọc và danh sách (FR-CHAT-009, DB §3.3)', () => {
  it('TC-DB-013 bỏ tin của mình, tin thu hồi, SYSTEM trừ CALL_MISSED của người khác; dừng ở 100', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = new Types.ObjectId(await direct(alice, bob));
    const base = { conversationId: conv, createdAt: new Date() };
    const enc = { v: 1, keyId: 'ktest1', iv: 'AAAAAAAAAAAAAAAA', ct: 'AA==', tag: 'AAAAAAAAAAAAAAAAAAAAAA==' };
    await MessageModel.insertMany([
      { ...base, senderId: alice.id, type: 'TEXT', clientMessageId: randomUUID(), contentEnc: enc },
      { ...base, senderId: alice.id, type: 'TEXT', clientMessageId: randomUUID(), deletedAt: new Date() },
      { ...base, senderId: alice.id, type: 'SYSTEM', system: { kind: 'MEMBER_ADDED', actorId: alice.id } },
      { ...base, senderId: alice.id, type: 'SYSTEM', system: { kind: 'CALL_MISSED', actorId: alice.id } },
      { ...base, senderId: bob.id, type: 'TEXT', clientMessageId: randomUUID(), contentEnc: enc },
    ]);
    expect(await messagesCore.countUnread(conv, bob.id, null)).toBe(2); // TEXT của alice + CALL_MISSED
    expect(await messagesCore.countUnread(conv, alice.id, null)).toBe(1);
    await MessageModel.insertMany(
      Array.from({ length: 150 }, () => ({
        ...base,
        senderId: alice.id,
        type: 'TEXT',
        clientMessageId: randomUUID(),
        contentEnc: enc,
      })),
    );
    expect(await messagesCore.countUnread(conv, bob.id, null)).toBe(100);
  });

  it('TC-AC-039 120 tin chưa đọc → unreadCount 100; preview = 100 code point đầu tin cuối; sắp theo lastMessageAt', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const carol = await chatUser(server, 'carol', sockets);
    const older = await direct(alice, carol);
    await sendOk(carol, older, 'cũ hơn');
    const conv = await direct(alice, bob);
    // 119 tin chèn thẳng (gửi qua socket sẽ chạm rate limit messageSend 20/10 s), tin cuối gửi thật để có lastMessage.
    const enc = { v: 1, keyId: 'ktest1', iv: 'AAAAAAAAAAAAAAAA', ct: 'AA==', tag: 'AAAAAAAAAAAAAAAAAAAAAA==' };
    await MessageModel.insertMany(
      Array.from({ length: 119 }, (_, i) => ({
        conversationId: conv,
        senderId: bob.id,
        type: 'TEXT',
        clientMessageId: randomUUID(),
        contentEnc: enc,
        createdAt: new Date(Date.now() - 1000 + i),
      })),
    );
    const long = '😀'.repeat(150);
    await sendOk(bob, conv, long);
    const page = (await server.http().get('/api/v1/conversations').set(bearer(alice))).body as ConversationPage;
    expect(page.items.map((c) => c.id)).toEqual([conv, older]);
    expect(page.items[0]).toMatchObject({
      unreadCount: 100,
      lastMessage: { preview: '😀'.repeat(100), sender: { id: bob.id } },
    });
  });

  it('TC-DB-014 groupReadStats: cursor null / bằng / vượt tin; người đã rời không tính', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const carol = await chatUser(server, 'carol', sockets);
    const dan = await chatUser(server, 'dan', sockets);
    const res = await server
      .http()
      .post('/api/v1/conversations')
      .set(bearer(alice))
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'GROUP', title: 'G', memberIds: [bob.id, carol.id, dan.id] });
    const g = (res.body as { conversation: { id: string } }).conversation.id;
    const m = await sendOk(alice, g, 'đọc chưa?');
    const later = await sendOk(alice, g, 'tin sau');
    await emitAck(bob.sock, EVENTS.MESSAGE_READ, receipt(g, m.id)); // bằng
    await emitAck(carol.sock, EVENTS.MESSAGE_READ, receipt(g, later.id)); // vượt
    const msg = {
      _id: new Types.ObjectId(m.id),
      createdAt: new Date(m.createdAt),
      senderId: new Types.ObjectId(alice.id),
    };
    expect(await server.runtime.conversations.groupReadStats(new Types.ObjectId(g), msg)).toEqual({
      total: 3,
      read: 2,
      delivered: 2,
    });
    await server.http().delete(`/api/v1/conversations/${g}/members/${carol.id}`).set(bearer(alice));
    expect(await server.runtime.conversations.groupReadStats(new Types.ObjectId(g), msg)).toEqual({
      total: 2,
      read: 1,
      delivered: 1,
    });
  });

  it('GROUP read → message:status GROUP_AGGREGATE tới room hội thoại', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const res = await server
      .http()
      .post('/api/v1/conversations')
      .set(bearer(alice))
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'GROUP', title: 'G', memberIds: [bob.id] });
    const g = (res.body as { conversation: { id: string } }).conversation.id;
    await emitAck(alice.sock, EVENTS.CONVERSATION_JOIN, { conversationId: g });
    const m = await sendOk(alice, g, 'xin chào nhóm');
    const status = waitFor<StatusEvent>(alice.sock, EVENTS.MESSAGE_STATUS);
    await emitAck(bob.sock, EVENTS.MESSAGE_READ, receipt(g, m.id));
    expect(await status).toMatchObject({ scope: 'GROUP_AGGREGATE', userId: bob.id, lastReadMessageId: m.id });
  });
});
