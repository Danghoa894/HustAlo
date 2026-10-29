import { describe, expect, it } from 'vitest';
import { MessageSendPayload } from '../schemas/socket.schema';
import { MessageHistoryQuerySchema, ReadRequestSchema } from '../schemas/message.schema';
import { BlockedUsersResponseSchema } from '../schemas/user.schema';

const conversationId = '6720a1b2c3d4e5f601234561';
const uuid = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const send = (p: object) =>
  MessageSendPayload.safeParse({ kind: 'PLAINTEXT', conversationId, clientMessageId: uuid, ...p });

describe('hợp đồng tin nhắn (FR-CHAT-002/003)', () => {
  it('TC-AC-035 TC-MSG-001 rỗng, khoảng trắng, zero-width, \\n\\t → lỗi', () => {
    for (const content of ['', '   ', '​​', '\n\t']) expect(send({ content }).success).toBe(false);
  });

  it('TC-AC-036 TC-MSG-002 4000 code point emoji ZWJ hợp lệ; 4001 → lỗi', () => {
    const family = '👨‍👩‍👧'; // 5 code point
    expect(send({ content: family.repeat(800) }).success).toBe(true);
    expect(send({ content: `${family.repeat(800)}a` }).success).toBe(false);
  });

  it('TC-MSG-005 payload có senderId/createdAt → lỗi (.strict)', () => {
    expect(send({ content: 'x', senderId: conversationId }).success).toBe(false);
    expect(send({ content: 'x', createdAt: new Date().toISOString() }).success).toBe(false);
  });

  it('TC-MSG-006 clientMessageId không phải UUID → lỗi', () => {
    expect(send({ content: 'x', clientMessageId: 'abc' }).success).toBe(false);
  });

  it('TC-MSG-016 PLAINTEXT kèm ciphertext → lỗi', () => {
    expect(send({ content: 'x', ciphertext: { v: 1, senderDeviceId: uuid, recipients: [] } }).success).toBe(false);
  });

  it('TC-AC-037 lịch sử: limit 1..100 (mặc định 30); before + after cùng lúc → lỗi', () => {
    expect(MessageHistoryQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(MessageHistoryQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(MessageHistoryQuerySchema.safeParse({ before: 'abc', after: 'def' }).success).toBe(false);
    expect(MessageHistoryQuerySchema.safeParse({ before: 'abc' }).success).toBe(true);
  });

  it('TC-SEC-003 ReadRequest strict: không nhận userId', () => {
    expect(ReadRequestSchema.safeParse({ upToMessageId: conversationId }).success).toBe(true);
    expect(ReadRequestSchema.safeParse({ upToMessageId: conversationId, userId: conversationId }).success).toBe(false);
  });

  it('BlockedUsersResponse: items UserPublic', () => {
    const user = { id: conversationId, username: 'bob', displayName: 'Bob', avatarUrl: null };
    expect(BlockedUsersResponseSchema.safeParse({ items: [user] }).success).toBe(true);
  });
});
