// packages/shared/src/events/socket-types.ts — kiểu Socket.IO có định kiểu (kiến trúc §4.5)
// Event có payload/ACK phụ thuộc DTO domain (Conversation, Message, CallStateEvent, UserPublic) được bổ sung
// ở milestone tạo DTO đó (M2: conversation, M3: message, M5: call).
import type { z } from 'zod';
import type {
  CallEndReason,
  CallStatus,
  CallType,
  ConversationChange,
  PresenceStatus,
  SessionRevokeReason,
} from '../enums';
import type { CallState } from '../schemas/call.schema';
import type { Conversation } from '../schemas/conversation.schema';
import type { Message } from '../schemas/message.schema';
import type { UserPublic } from '../schemas/user.schema';
import type { AckError } from '../errors';
import type {
  CallEndPayload,
  CallIcePayload,
  CallIceRestartPayload,
  CallIdPayload,
  CallInvitePayload,
  CallSdpPayload,
  CallStateReportPayload,
  PresenceSubscribePayload,
  ReceiptCursorPayload,
  TypingPayload,
  ConversationLeavePayload,
  ConversationJoinPayload,
  MessageDeletePayload,
  MessageEditPayload,
  MessageSendPayload,
} from '../schemas/socket.schema';
import type { EVENTS } from './event-names';

export interface ClientEnvelope<P> {
  requestId: string;
  payload: P;
}

export type AckResponse<D> =
  { ok: true; requestId: string; data: D } | { ok: false; requestId: string; error: AckError };

export type AckCallback<D> = (res: AckResponse<D>) => void;

type C2S<P extends z.ZodType, D> = (envelope: ClientEnvelope<z.input<P>>, ack: AckCallback<D>) => void;

export interface ServerEventMeta {
  eventId: string;
  occurredAt: string;
}

type S2C<P> = (payload: ServerEventMeta & P) => void;

export interface ClientToServerEvents {
  [EVENTS.CONVERSATION_JOIN]: C2S<
    typeof ConversationJoinPayload,
    { conversation: Conversation; unreadCount: number; typingUserIds: string[] }
  >;
  [EVENTS.CONVERSATION_LEAVE]: C2S<typeof ConversationLeavePayload, Record<string, never>>;
  [EVENTS.MESSAGE_SEND]: C2S<typeof MessageSendPayload, { message: Message; duplicate: boolean }>;
  [EVENTS.MESSAGE_EDIT]: C2S<typeof MessageEditPayload, { message: Message }>;
  [EVENTS.MESSAGE_DELETE]: C2S<typeof MessageDeletePayload, { message: Message }>;
  [EVENTS.MESSAGE_DELIVERED]: C2S<typeof ReceiptCursorPayload, { advanced: boolean }>;
  [EVENTS.MESSAGE_READ]: C2S<typeof ReceiptCursorPayload, { advanced: boolean; unreadCount: number }>;
  [EVENTS.TYPING_START]: C2S<typeof TypingPayload, Record<string, never>>;
  [EVENTS.TYPING_STOP]: C2S<typeof TypingPayload, Record<string, never>>;
  [EVENTS.PRESENCE_SUBSCRIBE]: C2S<typeof PresenceSubscribePayload, { accepted: string[] }>;
  [EVENTS.CALL_INVITE]: C2S<
    typeof CallInvitePayload,
    { callId: string; status: CallStatus; merged: boolean; callType: CallType }
  >;
  [EVENTS.CALL_ACCEPT]: C2S<typeof CallIdPayload, { callId: string; status: 'ACCEPTED' }>;
  [EVENTS.CALL_REJECT]: C2S<typeof CallIdPayload, { callId: string; status: 'REJECTED' }>;
  [EVENTS.CALL_CANCEL]: C2S<typeof CallIdPayload, { callId: string; status: CallStatus }>;
  [EVENTS.CALL_OFFER]: C2S<typeof CallSdpPayload, { revision: number }>;
  [EVENTS.CALL_ANSWER]: C2S<typeof CallSdpPayload, { revision: number }>;
  [EVENTS.CALL_ICE_CANDIDATE]: C2S<typeof CallIcePayload, Record<string, never>>;
  [EVENTS.CALL_ICE_RESTART]: C2S<typeof CallIceRestartPayload, { attempt: number }>;
  [EVENTS.CALL_END]: C2S<
    typeof CallEndPayload,
    { callId: string; status: CallStatus; endReason: CallEndReason | null }
  >;
  [EVENTS.CALL_STATE]: C2S<typeof CallStateReportPayload, { status: CallStatus; version: number }>;
}

export interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
}

export interface ServerToClientEvents {
  [EVENTS.SESSION_EXPIRED]: S2C<{ reason: 'TOKEN_EXPIRED'; expiredAt: string }>;
  [EVENTS.SESSION_REVOKED]: S2C<{ reason: SessionRevokeReason }>;
  [EVENTS.CONVERSATION_UPDATED]: S2C<{ conversation: Conversation; change: ConversationChange }>;
  [EVENTS.CONVERSATION_MEMBER_REMOVED]: S2C<{
    conversationId: string;
    userId: string;
    removedBy: string;
    reason: 'REMOVED' | 'LEFT';
  }>;
  [EVENTS.MESSAGE_NEW]: S2C<{ message: Message }>;
  [EVENTS.MESSAGE_EDIT]: S2C<{ message: Message }>;
  [EVENTS.MESSAGE_DELETE]: S2C<{ message: Message }>;
  [EVENTS.MESSAGE_STATUS]: S2C<
    | {
        conversationId: string;
        scope: 'MESSAGE';
        messageIds: string[];
        status: 'DELIVERED' | 'READ';
        byUserId: string;
        at: string;
      }
    | {
        conversationId: string;
        scope: 'GROUP_AGGREGATE';
        userId: string;
        lastDeliveredMessageId: string | null;
        lastReadMessageId: string | null;
      }
  >;
  [EVENTS.TYPING_UPDATE]: S2C<{ conversationId: string; userId: string; isTyping: boolean }>;
  [EVENTS.PRESENCE_SNAPSHOT]: S2C<{ users: PresenceEntry[]; degraded: boolean }>;
  [EVENTS.PRESENCE_UPDATE]: S2C<PresenceEntry>;
  [EVENTS.E2EE_PREKEYS_LOW]: S2C<{ deviceId: string; remaining: number }>;
  /** Có ACK: tab trả `{ ok: true }` khi đã hiện màn hình cuộc gọi đến (kiến trúc §4.5, T03). */
  [EVENTS.CALL_INCOMING]: (
    payload: ServerEventMeta & {
      callId: string;
      conversationId: string;
      callType: CallType;
      caller: UserPublic;
      ringExpiresAt: string;
    },
    ack: (res: { ok: true }) => void,
  ) => void;
  [EVENTS.CALL_RINGING]: S2C<{ callId: string; ringExpiresAt: string }>;
  [EVENTS.CALL_ACCEPTED]: S2C<{ callId: string; acceptedDeviceId: string; acceptedTabId: string }>;
  [EVENTS.CALL_ANSWERED_ELSEWHERE]: S2C<{ callId: string; reason: 'ANSWERED_ELSEWHERE' }>;
  [EVENTS.CALL_BUSY]: S2C<{ callId: string; caller: UserPublic; callType: CallType }>;
  [EVENTS.CALL_OFFER]: S2C<z.output<typeof CallSdpPayload>>;
  [EVENTS.CALL_ANSWER]: S2C<z.output<typeof CallSdpPayload>>;
  [EVENTS.CALL_ICE_CANDIDATE]: S2C<z.output<typeof CallIcePayload>>;
  [EVENTS.CALL_ICE_RESTART]: S2C<z.output<typeof CallIceRestartPayload>>;
  [EVENTS.CALL_STATE]: S2C<CallState>;
}
