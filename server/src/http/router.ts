// server/src/http/router.ts — mount /api/v1/* từ modules/*/routes
import { Router } from 'express';
import { healthRoutes } from '../modules/health/health.routes';
import type { HealthDeps } from '../modules/health/health.service';

export interface RouterDeps {
  health: HealthDeps;
}

export function apiRouter(deps: RouterDeps): Router {
  const router = Router();
  router.use(healthRoutes(deps.health));
  return router;
}
