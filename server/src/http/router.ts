// server/src/http/router.ts — mount /api/v1/* từ modules/*/routes
import { Router } from 'express';
import type { RateLimiters } from '../infra/rate-limit/rate-limiter';
import { authRoutes } from '../modules/auth/auth.routes';
import { callsRoutes } from '../modules/calls/calls.routes';
import type { CallsService } from '../modules/calls/calls.service';
import type { IceServersService } from '../modules/calls/iceServers.service';
import type { AuthService } from '../modules/auth/auth.service';
import { conversationsRoutes } from '../modules/conversations/conversations.routes';
import type { ConversationsService } from '../modules/conversations/conversations.service';
import { healthRoutes } from '../modules/health/health.routes';
import { messagesRoutes } from '../modules/messages/messages.routes';
import type { MessagesService } from '../modules/messages/messages.service';
import type { ReceiptsService } from '../modules/messages/receipts.service';
import type { HealthDeps } from '../modules/health/health.service';
import { usersRoutes } from '../modules/users/users.routes';
import type { UsersService } from '../modules/users/users.service';

export interface RouterDeps {
  health: HealthDeps;
  /** Không có ở test hạ tầng M0 (chỉ health). */
  modules?: {
    auth: AuthService;
    users: UsersService;
    conversations: ConversationsService;
    messages: MessagesService;
    receipts: ReceiptsService;
    calls: CallsService;
    iceServers: IceServersService;
    rateLimiters: RateLimiters;
  };
}

export function apiRouter(deps: RouterDeps): Router {
  const router = Router();
  router.use(healthRoutes(deps.health));
  if (deps.modules) {
    const { auth, users, conversations, messages, receipts, calls, iceServers, rateLimiters } = deps.modules;
    router.use(authRoutes(auth, rateLimiters));
    router.use(usersRoutes(users, auth, rateLimiters));
    router.use(messagesRoutes(messages, receipts, auth, rateLimiters));
    router.use(conversationsRoutes(conversations, auth, rateLimiters));
    router.use(callsRoutes(calls, iceServers, auth, rateLimiters));
  }
  return router;
}
