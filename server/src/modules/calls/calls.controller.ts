// server/src/modules/calls/calls.controller.ts — GET /calls (FR-CALL-008), GET /calls/ice-servers (FR-CALL-007)
import type { Request, RequestHandler, Response } from 'express';
import { getAuth } from '../../http/middleware/authenticate';
import type { CallHistoryQuery } from './calls.schema';
import type { CallsService } from './calls.service';
import type { IceServersService } from './iceServers.service';

const valid = (res: Response) => (res.locals as { valid: { query: unknown } }).valid;

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export function callsController(calls: CallsService, ice: IceServersService) {
  return {
    list: handle(async (_req, res) => {
      res.status(200).json(await calls.list(getAuth(res).userId, valid(res).query as CallHistoryQuery));
    }),

    iceServers: handle(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store'); // credential ngắn hạn
      res.status(200).json(await ice.get());
    }),
  };
}
