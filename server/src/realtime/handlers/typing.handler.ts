// server/src/realtime/handlers/typing.handler.ts — typing:start / typing:stop (kiến trúc §4.5; FR-CHAT-005).
// Rate limit `typing` do withAck áp theo bảng socket-rate-limit; userId lấy từ handshake.
import { EVENTS, TypingPayload } from '@hustalo/shared';
import type { Logger } from 'pino';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import type { TypingService } from '../../modules/presence/typing.service';
import type { HustaloServer } from '../gateway';
import { withAck } from '../with-ack';

export interface TypingHandlerDeps {
  typing: Pick<TypingService, 'start' | 'stop'>;
  logger: Logger;
  rateLimiters?: RateLimiters;
}

export function registerTypingHandlers(io: HustaloServer, deps: TypingHandlerDeps): void {
  const ackDeps = { logger: deps.logger, ...(deps.rateLimiters ? { rateLimiters: deps.rateLimiters } : {}) };
  io.on('connection', (socket) => {
    const auth = socket.data.auth;
    if (!auth) return;
    socket.on(
      EVENTS.TYPING_START,
      withAck(ackDeps, socket, { event: EVENTS.TYPING_START, schema: TypingPayload }, (p) =>
        deps.typing.start(auth.userId, p.conversationId),
      ),
    );
    socket.on(
      EVENTS.TYPING_STOP,
      withAck(ackDeps, socket, { event: EVENTS.TYPING_STOP, schema: TypingPayload }, (p) =>
        deps.typing.stop(auth.userId, p.conversationId),
      ),
    );
  });
}
