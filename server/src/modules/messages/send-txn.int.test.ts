import { randomUUID } from 'node:crypto';
import { EVENTS } from '@hustalo/shared';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chatUser, emitAck } from '../../test/chat';
import { testDb } from '../../test/db';
import { startTestServer, type TestServer } from '../../test/factories';
import { MessageReceiptModel } from './messageReceipt.model';

let server: TestServer;
const sockets: Socket[] = [];
/** Hook chạy giữa bước 1 (insert) và 2 (re-check thành viên) của transaction gửi. */
let afterInsert: (() => Promise<void>) | null = null;

beforeAll(async () => {
  server = await startTestServer({ messageHooks: { afterInsert: () => afterInsert?.() ?? Promise.resolve() } });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.reset();
  afterInsert = null;
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});

describe('transaction gửi tin (DB §4.4)', () => {
  it('TC-DB-007 người gửi bị xóa giữa bước 1 và 2 → abort: NOT_A_MEMBER, không còn message/receipt/lastMessage mới', async () => {
    const alice = await chatUser(server, 'alice', sockets);
    const bob = await chatUser(server, 'bob', sockets);
    const conv = (await server.runtime.conversations.getOrCreatePair('DIRECT', alice.id, bob.id)).id;
    afterInsert = () => testDb.setMemberLeft(conv, alice.id);
    const res = await emitAck(alice.sock, EVENTS.MESSAGE_SEND, {
      kind: 'PLAINTEXT',
      conversationId: conv,
      clientMessageId: randomUUID(),
      content: 'đang gửi dở',
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'NOT_A_MEMBER' } });
    expect(await testDb.countMessages(conv)).toBe(0);
    expect(await MessageReceiptModel.countDocuments({ conversationId: conv })).toBe(0);
    expect(await testDb.lastMessageIdOf(conv)).toBeNull();
  });
});
