// server/src/modules/health/health.routes.ts — GET /health (operationId getHealth, không cần xác thực)
import { Router } from 'express';
import { healthController } from './health.controller';
import type { HealthDeps } from './health.service';

export function healthRoutes(deps: HealthDeps): Router {
  const router = Router();
  router.get('/health', healthController(deps));
  return router;
}
