// server/src/modules/messages/messages.routes.ts — GET /conversations/{id}/messages, POST /conversations/{id}/read
import { Router } from 'express';
import { authenticate, type RevocationChecker } from '../../http/middleware/authenticate';
import { rateLimit, subjects } from '../../http/middleware/rate-limit';
import { validate } from '../../http/middleware/validate';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import { messagesController } from './messages.controller';
import { ConversationIdParamsSchema, MessageHistoryQuerySchema, ReadRequestSchema } from './messages.schema';
import type { MessagesService } from './messages.service';
import type { ReceiptsService } from './receipts.service';

export function messagesRoutes(
  messages: MessagesService,
  receipts: ReceiptsService,
  checker: RevocationChecker,
  limiters: RateLimiters,
): Router {
  const c = messagesController(messages, receipts);
  const router = Router();
  const guard = [authenticate(checker), rateLimit(limiters, 'rest', subjects.user)];
  router.get(
    '/conversations/:conversationId/messages',
    ...guard,
    validate({ params: ConversationIdParamsSchema, query: MessageHistoryQuerySchema }),
    c.history,
  );
  router.post(
    '/conversations/:conversationId/read',
    ...guard,
    validate({ params: ConversationIdParamsSchema, body: ReadRequestSchema }),
    c.read,
  );
  return router;
}
