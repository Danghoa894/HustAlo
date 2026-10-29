// server/src/realtime/handlers/message.handler.ts — message:send / delivered / read / edit / delete (kiến trúc §4.5, §7(b)).
// Chỉ gọi service; userId/deviceId lấy từ handshake (socket.data.auth), không bao giờ từ payload (EC-MSG-005, EC-SEC-003).
import {
  EVENTS,
  MessageDeletePayload,
  MessageEditPayload,
  MessageSendPayload,
  ReceiptCursorPayload,
} from '@hustalo/shared';
import type { Logger } from 'pino';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import type { MessagesService } from '../../modules/messages/messages.service';
import type { ReceiptsService } from '../../modules/messages/receipts.service';
import type { HustaloServer } from '../gateway';
import { withAck } from '../with-ack';

export interface MessageHandlerDeps {
  messages: Pick<MessagesService, 'send' | 'edit' | 'remove'>;
  receipts: Pick<ReceiptsService, 'markDelivered' | 'markRead'>;
  logger: Logger;
  rateLimiters?: RateLimiters;
}

export function registerMessageHandlers(io: HustaloServer, deps: MessageHandlerDeps): void {
  const ackDeps = { logger: deps.logger, ...(deps.rateLimiters ? { rateLimiters: deps.rateLimiters } : {}) };
  io.on('connection', (socket) => {
    const auth = socket.data.auth;
    if (!auth) return;
    const me = auth.userId;

    socket.on(
      EVENTS.MESSAGE_SEND,
      withAck(ackDeps, socket, { event: EVENTS.MESSAGE_SEND, schema: MessageSendPayload }, (p) =>
        deps.messages.send({ userId: me, deviceId: auth.deviceId }, p),
      ),
    );
    socket.on(
      EVENTS.MESSAGE_DELIVERED,
      withAck(ackDeps, socket, { event: EVENTS.MESSAGE_DELIVERED, schema: ReceiptCursorPayload }, (p) =>
        deps.receipts.markDelivered(me, p.conversationId, p.upToMessageId),
      ),
    );
    socket.on(
      EVENTS.MESSAGE_READ,
      withAck(ackDeps, socket, { event: EVENTS.MESSAGE_READ, schema: ReceiptCursorPayload }, (p) =>
        deps.receipts.markRead(me, p.conversationId, p.upToMessageId),
      ),
    );
    socket.on(
      EVENTS.MESSAGE_EDIT,
      withAck(ackDeps, socket, { event: EVENTS.MESSAGE_EDIT, schema: MessageEditPayload }, async (p) => ({
        message: await deps.messages.edit(me, p.messageId, p.content),
      })),
    );
    socket.on(
      EVENTS.MESSAGE_DELETE,
      withAck(ackDeps, socket, { event: EVENTS.MESSAGE_DELETE, schema: MessageDeletePayload }, async (p) => ({
        message: await deps.messages.remove(me, p.messageId),
      })),
    );
  });
}
