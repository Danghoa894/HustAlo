// packages/shared/src/schemas/conversation.schema.ts — hợp đồng REST /conversations (api_spec; PRD FR-CHAT-001,
// FR-CHAT-009, FR-CHAT-011, FR-GROUP-001..006) và DTO trả về cho client.
import { z } from 'zod';
import {
  CONVERSATION_PAGE_DEFAULT,
  CONVERSATION_PAGE_MAX,
  DISPLAY_NAME_MAX,
  GROUP_ADD_BATCH_MAX,
  GROUP_MAX_MEMBERS,
  GROUP_TITLE_MAX,
} from '../constants';
import { CallType, ConversationType, MemberRole, MessageType, SystemEventKind } from '../enums';
import { countCodePoints, normalizeDisplayName } from '../utils/text';
import { isoDate, objectId, pageCursor, uuidV4 } from './common.schema';
import { UserPublicSchema } from './user.schema';

const enumOf = <T extends Record<string, string>>(o: T) => z.enum(Object.values(o) as [T[keyof T], ...T[keyof T][]]);

export const ConversationTypeSchema = enumOf(ConversationType);
export const MemberRoleSchema = enumOf(MemberRole);
export const SystemEventKindSchema = enumOf(SystemEventKind);

/** Tên nhóm: NFC + trim hai đầu (gồm zero-width), 1..GROUP_TITLE_MAX code point (FR-GROUP-001/005). */
export const groupTitleSchema = z
  .string()
  .transform(normalizeDisplayName)
  .refine((s) => countCodePoints(s) >= 1, { message: 'Tên nhóm không được để trống' })
  .refine((s) => countCodePoints(s) <= GROUP_TITLE_MAX, { message: `Tên nhóm tối đa ${GROUP_TITLE_MAX} ký tự` });

/** Header Idempotency-Key của POST /conversations. */
export const IdempotencyKeySchema = uuidV4;

// ---- Request ----
const pairRequest = <T extends 'DIRECT' | 'SECRET'>(type: T) =>
  z.object({ type: z.literal(type), memberIds: z.array(objectId).length(1) }).strict();

export const CreateConversationRequestSchema = z.discriminatedUnion('type', [
  pairRequest('DIRECT'),
  pairRequest('SECRET'),
  z
    .object({
      type: z.literal('GROUP'),
      title: groupTitleSchema,
      memberIds: z
        .array(objectId)
        .min(1)
        .max(GROUP_MAX_MEMBERS - 1),
    })
    .strict(),
]);
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

export const UpdateConversationRequestSchema = z.object({ title: groupTitleSchema }).strict();
export type UpdateConversationRequest = z.infer<typeof UpdateConversationRequestSchema>;

export const AddMembersRequestSchema = z
  .object({ userIds: z.array(objectId).min(1).max(GROUP_ADD_BATCH_MAX) })
  .strict();
export type AddMembersRequest = z.infer<typeof AddMembersRequestSchema>;

export const UpdateMemberRoleRequestSchema = z.object({ role: MemberRoleSchema }).strict();
export type UpdateMemberRoleRequest = z.infer<typeof UpdateMemberRoleRequestSchema>;

export const ConversationListQuerySchema = z
  .object({
    cursor: pageCursor.optional(),
    limit: z.coerce.number().int().min(1).max(CONVERSATION_PAGE_MAX).default(CONVERSATION_PAGE_DEFAULT),
  })
  .strict();
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;

export const ConversationIdParamsSchema = z.object({ conversationId: objectId }).strict();
export const ConversationMemberParamsSchema = z.object({ conversationId: objectId, userId: objectId }).strict();

// ---- DTO ----
export const UserRefSchema = z.object({ id: objectId, displayName: z.string().max(DISPLAY_NAME_MAX) }).strict();
export type UserRef = z.infer<typeof UserRefSchema>;

/**
 * Payload tin SYSTEM trong DTO (FR-CHAT-011); `role` = role mới của target, chỉ ROLE_CHANGED;
 * `targets` = tên hiện tại của `targetUserIds` cùng thứ tự (server tra theo lô, không lưu DB).
 */
export const SystemPayloadSchema = z
  .object({
    kind: SystemEventKindSchema,
    actorId: objectId,
    targetUserIds: z.array(objectId),
    targets: z.array(UserRefSchema).max(GROUP_MAX_MEMBERS),
    title: z.string().nullable(),
    role: z.enum(['ADMIN', 'MEMBER']).nullable(),
    callId: objectId.nullable(),
    callType: enumOf(CallType).nullable(),
    durationSec: z.number().int().min(0).nullable(),
  })
  .strict();
export type SystemPayload = z.infer<typeof SystemPayloadSchema>;

/** Số target tối đa kèm tên trong preview SYSTEM của danh sách chat. */
export const SYSTEM_PREVIEW_TARGETS_MAX = 3;

export const SystemPreviewSchema = z
  .object({
    kind: SystemEventKindSchema,
    actor: UserRefSchema,
    targets: z.array(UserRefSchema).max(SYSTEM_PREVIEW_TARGETS_MAX),
    targetCount: z.number().int().min(0),
    title: z.string().nullable(),
    role: z.enum(['ADMIN', 'MEMBER']).nullable(),
    callType: enumOf(CallType).nullable(),
    durationSec: z.number().int().min(0).nullable(),
  })
  .strict();
export type SystemPreview = z.infer<typeof SystemPreviewSchema>;

export const LastMessagePreviewSchema = z
  .object({
    id: objectId,
    senderId: objectId,
    /** Tên hiện tại của người gửi — tiền tố "{tên}: " cho tin TEXT trong GROUP (ui_ux_spec.md §3.2). */
    sender: UserRefSchema,
    type: enumOf(MessageType),
    preview: z.string().max(100).nullable(),
    system: SystemPreviewSchema.nullable(),
    createdAt: isoDate,
    deletedAt: isoDate.nullable(),
  })
  .strict();
export type LastMessagePreview = z.infer<typeof LastMessagePreviewSchema>;

export const ConversationSummarySchema = z
  .object({
    id: objectId,
    type: ConversationTypeSchema,
    title: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    peer: UserPublicSchema.optional(),
    memberCount: z.number().int().min(1).max(GROUP_MAX_MEMBERS),
    lastMessage: LastMessagePreviewSchema.nullable(),
    lastMessageAt: isoDate,
    unreadCount: z.number().int().min(0).max(100),
    myLastDeliveredMessageId: objectId.nullable(),
    myLastReadMessageId: objectId.nullable(),
    blockedByMe: z.boolean(),
    canMessage: z.boolean(),
  })
  .strict();
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationPageSchema = z
  .object({ items: z.array(ConversationSummarySchema).max(CONVERSATION_PAGE_MAX), nextCursor: z.string().nullable() })
  .strict();
export type ConversationPage = z.infer<typeof ConversationPageSchema>;

export const MemberSchema = z
  .object({
    userId: objectId,
    user: UserPublicSchema,
    role: MemberRoleSchema,
    joinedAt: isoDate,
    lastDeliveredMessageId: objectId.nullable(),
    lastReadMessageId: objectId.nullable(),
  })
  .strict();
export type Member = z.infer<typeof MemberSchema>;

export const ConversationSchema = z
  .object({
    id: objectId,
    type: ConversationTypeSchema,
    title: z.string().nullable(),
    createdBy: objectId,
    memberCount: z.number().int().min(1).max(GROUP_MAX_MEMBERS),
    members: z.array(MemberSchema).max(GROUP_MAX_MEMBERS),
    lastMessageAt: isoDate,
    blockedByMe: z.boolean(),
    canMessage: z.boolean(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();
export type Conversation = z.infer<typeof ConversationSchema>;

export const SkippedMemberSchema = z
  .object({ userId: objectId, code: z.enum(['CONFLICT', 'NOT_FOUND', 'USER_BLOCKED']) })
  .strict();
export type SkippedMember = z.infer<typeof SkippedMemberSchema>;

export const CreateConversationResponseSchema = z
  .object({ conversation: ConversationSchema, skipped: z.array(SkippedMemberSchema) })
  .strict();
export type CreateConversationResponse = z.infer<typeof CreateConversationResponseSchema>;

export const AddMembersResponseSchema = z
  .object({ added: z.array(MemberSchema), skipped: z.array(SkippedMemberSchema) })
  .strict();
export type AddMembersResponse = z.infer<typeof AddMembersResponseSchema>;
