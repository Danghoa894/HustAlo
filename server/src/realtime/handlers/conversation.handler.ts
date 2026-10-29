// server/src/realtime/handlers/conversation.handler.ts — conversation:join / conversation:leave (kiến trúc §4.5).
// join: AUTHZ-2 qua conversations.service rồi mới vào room conv:{id} (EC-SEC-002); leave chỉ rời room.
import { ConversationJoinPayload, ConversationLeavePayload, EVENTS } from '@hustalo/shared';
import type { Logger } from 'pino';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import type { ConversationsService } from '../../modules/conversations/conversations.service';
import type { HustaloServer } from '../gateway';
import { convRoom } from '../rooms';
import { withAck } from '../with-ack';

export interface ConversationHandlerDeps {
  conversations: Pick<ConversationsService, 'join'>;
  logger: Logger;
  rateLimiters?: RateLimiters;
}

export function registerConversationHandlers(io: HustaloServer, deps: ConversationHandlerDeps): void {
  const ackDeps = { logger: deps.logger, ...(deps.rateLimiters ? { rateLimiters: deps.rateLimiters } : {}) };
  io.on('connection', (socket) => {
    const auth = socket.data.auth;
    if (!auth) return;

    socket.on(
      EVENTS.CONVERSATION_JOIN,
      withAck(ackDeps, socket, { event: EVENTS.CONVERSATION_JOIN, schema: ConversationJoinPayload }, async (p) => {
        const result = await deps.conversations.join(auth.userId, p.conversationId);
        await socket.join(convRoom(p.conversationId));
        return result;
      }),
    );

    socket.on(
      EVENTS.CONVERSATION_LEAVE,
      withAck(ackDeps, socket, { event: EVENTS.CONVERSATION_LEAVE, schema: ConversationLeavePayload }, async (p) => {
        await socket.leave(convRoom(p.conversationId));
        return {};
      }),
    );
  });
}
