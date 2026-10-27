// packages/shared/src/events/socket-types.ts — kiểu Socket.IO có định kiểu (kiến trúc §4.5)
// Event có payload/ACK phụ thuộc DTO domain (Conversation, Message, CallStateEvent, UserPublic) được bổ sung
// ở milestone tạo DTO đó (M2: conversation, M3: message, M5: call).
import type { z } from 'zod';
import type { PresenceStatus, SessionRevokeReason } from '../enums';
import type { AckError } from '../errors';
import type {
  PresenceSubscribePayload,
  ReceiptCursorPayload,
  TypingPayload,
  ConversationLeavePayload,
} from '../schemas/socket.schema';
import type { EVENTS } from './event-names';

export interface ClientEnvelope<P> {
  requestId: string;
  payload: P;
}

export type AckResponse<D> =
  { ok: true; requestId: string; data: D } | { ok: false; requestId: string; error: AckError };

export type AckCallback<D> = (res: AckResponse<D>) => void;

type C2S<P extends z.ZodTypeAny, D> = (envelope: ClientEnvelope<z.input<P>>, ack: AckCallback<D>) => void;

export interface ServerEventMeta {
  eventId: string;
  occurredAt: string;
}

type S2C<P> = (payload: ServerEventMeta & P) => void;

export interface ClientToServerEvents {
  [EVENTS.CONVERSATION_LEAVE]: C2S<typeof ConversationLeavePayload, Record<string, never>>;
  [EVENTS.MESSAGE_DELIVERED]: C2S<typeof ReceiptCursorPayload, { advanced: boolean }>;
  [EVENTS.MESSAGE_READ]: C2S<typeof ReceiptCursorPayload, { advanced: boolean; unreadCount: number }>;
  [EVENTS.TYPING_START]: C2S<typeof TypingPayload, Record<string, never>>;
  [EVENTS.TYPING_STOP]: C2S<typeof TypingPayload, Record<string, never>>;
  [EVENTS.PRESENCE_SUBSCRIBE]: C2S<typeof PresenceSubscribePayload, { accepted: string[] }>;
}

export interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
}

export interface ServerToClientEvents {
  [EVENTS.SESSION_EXPIRED]: S2C<{ reason: 'TOKEN_EXPIRED'; expiredAt: string }>;
  [EVENTS.SESSION_REVOKED]: S2C<{ reason: SessionRevokeReason }>;
  [EVENTS.CONVERSATION_MEMBER_REMOVED]: S2C<{
    conversationId: string;
    userId: string;
    removedBy: string;
    reason: 'REMOVED' | 'LEFT';
  }>;
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
}
