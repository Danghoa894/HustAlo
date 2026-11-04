// server/src/modules/e2ee/e2ee.routes.ts — /e2ee/devices…, /e2ee/users/{userId}/bundles (rate limit rest / e2eeBundle)
import { Router, type Request, type Response } from 'express';
import { authenticate, getAuth, type RevocationChecker } from '../../http/middleware/authenticate';
import { rateLimit, subjects } from '../../http/middleware/rate-limit';
import { validate } from '../../http/middleware/validate';
import type { RateLimiters } from '../../infra/rate-limit/rate-limiter';
import { e2eeController } from './e2ee.controller';
import {
  DeviceIdParamsSchema,
  RegisterDeviceKeysRequestSchema,
  UploadPreKeysRequestSchema,
  UserIdParamsSchema,
} from './e2ee.schema';
import type { E2eeService } from './e2ee.service';

/** RATE_LIMITS.e2eeBundle key 'user+target': chống rút cạn one-time prekey của một người (FR-E2EE-002). */
const userAndTarget = (req: Request, res: Response) => `${getAuth(res).userId}:${String(req.params.userId)}`;

export function e2eeRoutes(e2ee: E2eeService, checker: RevocationChecker, limiters: RateLimiters): Router {
  const c = e2eeController(e2ee);
  const router = Router();
  const rest = rateLimit(limiters, 'rest', subjects.user);
  const device = validate({ params: DeviceIdParamsSchema });
  router.use('/e2ee', authenticate(checker));
  router.get('/e2ee/devices', rest, c.listDevices);
  router.delete('/e2ee/devices/:deviceId', rest, device, c.revokeDevice);
  router.put(
    '/e2ee/devices/:deviceId/keys',
    rest,
    validate({ params: DeviceIdParamsSchema, body: RegisterDeviceKeysRequestSchema }),
    c.registerKeys,
  );
  router.post(
    '/e2ee/devices/:deviceId/prekeys',
    rest,
    validate({ params: DeviceIdParamsSchema, body: UploadPreKeysRequestSchema }),
    c.uploadPreKeys,
  );
  router.get(
    '/e2ee/users/:userId/bundles',
    validate({ params: UserIdParamsSchema }),
    rateLimit(limiters, 'e2eeBundle', userAndTarget),
    c.bundles,
  );
  return router;
}
