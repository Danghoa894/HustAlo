// server/src/modules/users/users.routes.ts — /users/search, /users/me, /users/{userId}/block
import { Router } from 'express';
import { authenticate, type RevocationChecker } from '../../http/middleware/authenticate';
import { rateLimit, subjects } from '../../http/middleware/rate-limit';
import { validate } from '../../http/middleware/validate';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import { usersController } from './users.controller';
import { UpdateMeRequestSchema, UserIdParamsSchema, UserSearchQuerySchema } from './users.schema';
import type { UsersService } from './users.service';

export function usersRoutes(service: UsersService, checker: RevocationChecker, limiters: RateLimiters): Router {
  const c = usersController(service);
  const router = Router();
  router.use('/users', authenticate(checker), rateLimit(limiters, 'rest', subjects.user));
  router.get('/users/search', validate({ query: UserSearchQuerySchema }), c.search);
  router.patch('/users/me', validate({ body: UpdateMeRequestSchema }), c.updateMe);
  router.post('/users/:userId/block', validate({ params: UserIdParamsSchema }), c.block);
  router.delete('/users/:userId/block', validate({ params: UserIdParamsSchema }), c.unblock);
  return router;
}
