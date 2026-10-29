import { describe, expect, it } from 'vitest';
import {
  AddMembersRequestSchema,
  ConversationListQuerySchema,
  CreateConversationRequestSchema,
  IdempotencyKeySchema,
  SystemPayloadSchema,
  UpdateConversationRequestSchema,
  UpdateMemberRoleRequestSchema,
  groupTitleSchema,
} from '../schemas/conversation.schema';

const id = (n: number) => `6720a1b2c3d4e5f60123456${String(n)}`;

describe('hợp đồng REST hội thoại (api_spec /conversations)', () => {
  it('CreateConversationRequest: DIRECT đúng 1 memberId; trường lạ → lỗi', () => {
    expect(CreateConversationRequestSchema.safeParse({ type: 'DIRECT', memberIds: [id(1)] }).success).toBe(true);
    expect(CreateConversationRequestSchema.safeParse({ type: 'DIRECT', memberIds: [id(1), id(2)] }).success).toBe(
      false,
    );
    expect(CreateConversationRequestSchema.safeParse({ type: 'DIRECT', memberIds: [id(1)], x: 1 }).success).toBe(false);
    expect(CreateConversationRequestSchema.safeParse({ type: 'SECRET', memberIds: [id(1)] }).success).toBe(true);
  });

  it('CreateConversationRequest GROUP: title NFC + trim, 1..99 memberIds', () => {
    const r = CreateConversationRequestSchema.safeParse({ type: 'GROUP', title: '  Dự án  ', memberIds: [id(1)] });
    expect(r.success && r.data.type === 'GROUP' && r.data.title).toBe('Dự án');
    const ids = Array.from({ length: 100 }, (_, i) => `6720a1b2c3d4e5f6012${String(i).padStart(5, '0')}`);
    expect(CreateConversationRequestSchema.safeParse({ type: 'GROUP', title: 'G', memberIds: ids }).success).toBe(
      false,
    );
    expect(CreateConversationRequestSchema.safeParse({ type: 'GROUP', title: 'G', memberIds: [] }).success).toBe(false);
  });

  it('TC-AC-056 tên nhóm 101 ký tự → lỗi; 100 ký tự (kể cả emoji) → hợp lệ; chỉ khoảng trắng → lỗi', () => {
    expect(groupTitleSchema.safeParse('a'.repeat(101)).success).toBe(false);
    expect(groupTitleSchema.safeParse('😀'.repeat(100)).success).toBe(true);
    expect(groupTitleSchema.safeParse('   ').success).toBe(false);
    expect(UpdateConversationRequestSchema.safeParse({ title: 'Nhóm mới' }).success).toBe(true);
  });

  it('AddMembersRequest: 1..50 userIds', () => {
    expect(AddMembersRequestSchema.safeParse({ userIds: [id(1)] }).success).toBe(true);
    expect(AddMembersRequestSchema.safeParse({ userIds: [] }).success).toBe(false);
    const ids = Array.from({ length: 51 }, (_, i) => `6720a1b2c3d4e5f6012${String(i).padStart(5, '0')}`);
    expect(AddMembersRequestSchema.safeParse({ userIds: ids }).success).toBe(false);
  });

  it('UpdateMemberRoleRequest: OWNER | ADMIN | MEMBER', () => {
    for (const role of ['OWNER', 'ADMIN', 'MEMBER']) {
      expect(UpdateMemberRoleRequestSchema.safeParse({ role }).success).toBe(true);
    }
    expect(UpdateMemberRoleRequestSchema.safeParse({ role: 'ROOT' }).success).toBe(false);
  });

  it('ConversationListQuery: limit mặc định 20, tối đa 50; cursor base64url', () => {
    expect(ConversationListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(ConversationListQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(ConversationListQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(ConversationListQuerySchema.safeParse({ cursor: 'a b' }).success).toBe(false);
  });

  it('Idempotency-Key là UUID v4', () => {
    expect(IdempotencyKeySchema.safeParse('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b').success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('abc').success).toBe(false);
  });

  it('SystemPayload có role (chỉ ROLE_CHANGED: ADMIN | MEMBER)', () => {
    const base = {
      kind: 'ROLE_CHANGED',
      actorId: id(1),
      targetUserIds: [id(2)],
      targets: [{ id: id(2), displayName: 'Bob' }],
      title: null,
      role: 'ADMIN',
      callId: null,
      callType: null,
      durationSec: null,
    };
    expect(SystemPayloadSchema.safeParse(base).success).toBe(true);
    expect(SystemPayloadSchema.safeParse({ ...base, role: 'OWNER' }).success).toBe(false);
  });
});
