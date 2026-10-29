// server/src/modules/conversations/conversations.routes.ts — /conversations, /conversations/{id}, /members
import { Router } from 'express';
import { authenticate, type RevocationChecker } from '../../http/middleware/authenticate';
import { rateLimit, subjects } from '../../http/middleware/rate-limit';
import { validate } from '../../http/middleware/validate';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import { conversationsController } from './conversations.controller';
import {
  AddMembersRequestSchema,
  ConversationIdParamsSchema,
  ConversationListQuerySchema,
  ConversationMemberParamsSchema,
  CreateConversationRequestSchema,
  UpdateConversationRequestSchema,
  UpdateMemberRoleRequestSchema,
} from './conversations.schema';
import type { ConversationsService } from './conversations.service';

export function conversationsRoutes(
  service: ConversationsService,
  checker: RevocationChecker,
  limiters: RateLimiters,
): Router {
  const c = conversationsController(service);
  const router = Router();
  router.use('/conversations', authenticate(checker), rateLimit(limiters, 'rest', subjects.user));
  router.get('/conversations', validate({ query: ConversationListQuerySchema }), c.list);
  router.post('/conversations', validate({ body: CreateConversationRequestSchema }), c.create);
  router.get('/conversations/:conversationId', validate({ params: ConversationIdParamsSchema }), c.get);
  router.patch(
    '/conversations/:conversationId',
    validate({ params: ConversationIdParamsSchema, body: UpdateConversationRequestSchema }),
    c.rename,
  );
  router.post(
    '/conversations/:conversationId/members',
    validate({ params: ConversationIdParamsSchema, body: AddMembersRequestSchema }),
    c.addMembers,
  );
  router.patch(
    '/conversations/:conversationId/members/:userId',
    validate({ params: ConversationMemberParamsSchema, body: UpdateMemberRoleRequestSchema }),
    c.changeRole,
  );
  router.delete(
    '/conversations/:conversationId/members/:userId',
    validate({ params: ConversationMemberParamsSchema }),
    c.removeMember,
  );
  return router;
}
