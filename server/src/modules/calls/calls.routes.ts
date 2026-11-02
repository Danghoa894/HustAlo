// server/src/modules/calls/calls.routes.ts — GET /calls, GET /calls/ice-servers
import { Router } from 'express';
import { authenticate, type RevocationChecker } from '../../http/middleware/authenticate';
import { rateLimit, subjects } from '../../http/middleware/rate-limit';
import { validate } from '../../http/middleware/validate';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import { callsController } from './calls.controller';
import { CallHistoryQuerySchema } from './calls.schema';
import type { CallsService } from './calls.service';
import type { IceServersService } from './iceServers.service';

export function callsRoutes(
  calls: CallsService,
  ice: IceServersService,
  checker: RevocationChecker,
  limiters: RateLimiters,
): Router {
  const c = callsController(calls, ice);
  const router = Router();
  router.use('/calls', authenticate(checker), rateLimit(limiters, 'rest', subjects.user));
  router.get('/calls', validate({ query: CallHistoryQuerySchema }), c.list);
  router.get('/calls/ice-servers', c.iceServers);
  return router;
}
