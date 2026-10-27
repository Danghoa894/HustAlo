// server/src/modules/health/health.controller.ts
import type { RequestHandler } from 'express';
import { getHealth, type HealthDeps } from './health.service';

export function healthController(deps: HealthDeps): RequestHandler {
  return (_req, res, next) => {
    getHealth(deps)
      .then(({ httpStatus, body }) => {
        res.status(httpStatus).json(body);
      })
      .catch(next);
  };
}
