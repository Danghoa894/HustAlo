// packages/shared/src/schemas/message.schema.ts — DTO tin nhắn và REST lịch sử / đánh dấu đã đọc (api_spec Message,
// MessagePage, ReadRequest, ReadResponse; PRD FR-CHAT-002..004, FR-CHAT-011)
import { z } from 'zod';
import { HISTORY_PAGE_DEFAULT, HISTORY_PAGE_MAX, MESSAGE_MAX_LENGTH, UNREAD_COUNT_CAP } from '../constants';
import { MessageType } from '../enums';
import { isoDate, objectId, pageCursor, uuidV4 } from './common.schema';
import { SystemPayloadSchema, UserRefSchema } from './conversation.schema';

/** Envelope SECRET trả cho một device: chỉ còn phần tử của device đó (0 hoặc 1). */
export const E2eeEnvelopeViewSchema = z
  .object({
    v: z.literal(1),
    senderDeviceId: uuidV4,
    recipients: z
      .array(z.object({ deviceId: uuidV4, type: z.union([z.literal(1), z.literal(3)]), body: z.string() }).strict())
      .max(1),
  })
  .strict();

/** Chỉ có cho tin của chính mình trong DIRECT/SECRET. */
export const MessageReceiptInfoSchema = z
  .object({ deliveredAt: isoDate.nullable(), readAt: isoDate.nullable() })
  .strict();
export type MessageReceiptInfo = z.infer<typeof MessageReceiptInfoSchema>;

export const MessageSchema = z
  .object({
    id: objectId,
    conversationId: objectId,
    senderId: objectId,
    sender: UserRefSchema,
    senderDeviceId: uuidV4.nullable(),
    clientMessageId: uuidV4.nullable(),
    type: z.enum([MessageType.TEXT, MessageType.SYSTEM]),
    content: z
      .string()
      .max(MESSAGE_MAX_LENGTH * 2)
      .nullable(), // giới hạn code point kiểm khi gửi; *2 cho UTF-16
    ciphertext: E2eeEnvelopeViewSchema.nullable(),
    system: SystemPayloadSchema.nullable(),
    receipt: MessageReceiptInfoSchema.nullable(),
    createdAt: isoDate,
    editedAt: isoDate.nullable(),
    deletedAt: isoDate.nullable(),
  })
  .strict();
export type Message = z.infer<typeof MessageSchema>;

export const MessagePageSchema = z
  .object({
    items: z.array(MessageSchema).max(HISTORY_PAGE_MAX),
    nextBefore: z.string().nullable(),
    nextAfter: z.string().nullable(),
  })
  .strict();
export type MessagePage = z.infer<typeof MessagePageSchema>;

/** GET /conversations/{id}/messages — `before` và `after` loại trừ nhau (FR-CHAT-003). */
export const MessageHistoryQuerySchema = z
  .object({
    before: pageCursor.optional(),
    after: pageCursor.optional(),
    limit: z.coerce.number().int().min(1).max(HISTORY_PAGE_MAX).default(HISTORY_PAGE_DEFAULT),
  })
  .strict()
  .refine((q) => !(q.before && q.after), { message: 'Chỉ dùng before hoặc after', path: ['before'] });
export type MessageHistoryQuery = z.infer<typeof MessageHistoryQuerySchema>;

export const ReadRequestSchema = z.object({ upToMessageId: objectId }).strict();
export type ReadRequest = z.infer<typeof ReadRequestSchema>;

export const ReadResponseSchema = z
  .object({
    advanced: z.boolean(),
    unreadCount: z
      .number()
      .int()
      .min(0)
      .max(UNREAD_COUNT_CAP + 1),
  })
  .strict();
export type ReadResponse = z.infer<typeof ReadResponseSchema>;
