// server/src/app.ts — createApp(deps): express + middleware + router + error handler
import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { metrics } from './infra/metrics/metrics';
import { errorHandler, notFoundHandler } from './http/middleware/error-handler';
import { genRequestId } from './http/middleware/request-id';
import { securityMiddleware } from './http/middleware/security';
import { apiRouter, type RouterDeps } from './http/router';

export const API_PREFIX = '/api/v1';

export interface AppDeps extends RouterDeps {
  logger: Logger;
  corsOrigins: readonly string[];
  trustProxy: number;
  production: boolean;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxy);

  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: genRequestId,
      // Chỉ log method/url/status/thời gian; không log body hay header nhạy cảm (đã redact).
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use((req, res, next) => {
    const end = metrics.httpRequestDuration.startTimer({ method: req.method });
    res.on('finish', () => {
      // Route template (không chứa id); request không khớp route nào → 'unmatched'.
      const route = req.route ? `${req.baseUrl}${(req.route as { path: string }).path}` : 'unmatched';
      end({ route, status: String(res.statusCode) });
    });
    next();
  });
  app.use(securityMiddleware({ corsOrigins: deps.corsOrigins, production: deps.production }));
  app.use(API_PREFIX, apiRouter(deps));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
