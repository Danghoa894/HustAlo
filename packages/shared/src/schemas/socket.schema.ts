// packages/shared/src/schemas/socket.schema.ts — envelope, ACK và payload event C→S (kiến trúc §4.5)
import { z } from 'zod';
import {
  CALL_ICE_CANDIDATE_MAX_LENGTH,
  CALL_SDP_MAX_LENGTH,
  E2EE_MAX_DEVICES_PER_USER,
  PRESENCE_SUBSCRIBE_MAX,
} from '../constants';
import { CLIENT_CALL_END_REASONS } from '../enums';
import { ErrorCode } from '../errors';
import { normalizedText, objectId } from './common.schema';

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const clientEnvelope = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({ requestId: z.string().uuid(), payload }).strict();

export const ackOk = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ ok: z.literal(true), requestId: z.string().uuid(), data });

export const ackErr = z.object({
  ok: z.literal(false),
  requestId: z.string().uuid(), // = requestId của envelope; envelope hỏng không đọc được requestId → NIL_UUID
  error: z.object({
    code: z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
  }),
});

// Mọi event server → client có thêm 2 trường
export const serverEventMeta = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(), // ISO-8601 UTC, đồng hồ server
});

const uuid = z.string().uuid();

// ---- Conversation ----
export const ConversationJoinPayload = z.object({ conversationId: objectId }).strict();
export const ConversationLeavePayload = ConversationJoinPayload;

// ---- E2EE envelope ----
export const E2eeEnvelope = z
  .object({
    v: z.literal(1),
    senderDeviceId: uuid,
    recipients: z
      .array(
        z
          .object({
            deviceId: uuid,
            type: z.union([z.literal(1), z.literal(3)]), // SignalMessageType
            body: z
              .string()
              .min(1)
              .max(16384)
              .regex(/^[A-Za-z0-9+/]+={0,2}$/), // base64
          })
          .strict(),
      )
      .min(1)
      .max(2 * E2EE_MAX_DEVICES_PER_USER),
  })
  .strict();

// ---- Message ----
export const MessageSendPayload = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('PLAINTEXT'), // DIRECT, GROUP
      conversationId: objectId,
      clientMessageId: uuid,
      content: normalizedText, // 1..MESSAGE_MAX_LENGTH code point
    })
    .strict(),
  z
    .object({
      kind: z.literal('E2EE'), // SECRET
      conversationId: objectId,
      clientMessageId: uuid,
      ciphertext: E2eeEnvelope, // .strict(): có trường content → VALIDATION_ERROR
    })
    .strict(),
]);
export const ReceiptCursorPayload = z.object({ conversationId: objectId, upToMessageId: objectId }).strict();
export const MessageEditPayload = z.object({ messageId: objectId, content: normalizedText }).strict();
export const MessageDeletePayload = z.object({ messageId: objectId }).strict();

// ---- Typing / presence ----
export const TypingPayload = z.object({ conversationId: objectId }).strict();
export const PresenceSubscribePayload = z
  .object({
    userIds: z.array(objectId).min(1).max(PRESENCE_SUBSCRIBE_MAX),
  })
  .strict();

// ---- Call ----
export const CallInvitePayload = z.object({ conversationId: objectId, callType: z.enum(['VOICE', 'VIDEO']) }).strict();
export const CallIdPayload = z.object({ callId: objectId }).strict(); // accept, reject, cancel
export const CallSdpPayload = z
  .object({
    // offer, answer
    callId: objectId,
    revision: z.number().int().min(1),
    sdp: z.string().min(1).max(CALL_SDP_MAX_LENGTH),
  })
  .strict();
export const CallIcePayload = z
  .object({
    callId: objectId,
    revision: z.number().int().min(1),
    candidate: z
      .object({
        candidate: z.string().max(CALL_ICE_CANDIDATE_MAX_LENGTH), // "" = end-of-candidates
        sdpMid: z.string().max(64).nullable(),
        sdpMLineIndex: z.number().int().min(0).max(16).nullable(),
        usernameFragment: z.string().max(256).nullable(),
      })
      .strict(),
  })
  .strict();
export const CallIceRestartPayload = z
  .object({
    callId: objectId,
    attempt: z.number().int().min(1), // giới hạn CALL_MAX_ICE_RESTARTS kiểm ở state machine (T30) → CALL_INVALID_STATE
  })
  .strict();
export const CallEndPayload = z.object({ callId: objectId, reason: z.enum(CLIENT_CALL_END_REASONS) }).strict();
export const CallStateReportPayload = z
  .object({
    callId: objectId,
    connectionState: z.enum(['connected', 'disconnected', 'failed']), // MediaConnectionReport
  })
  .strict();
