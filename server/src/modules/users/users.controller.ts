// server/src/modules/users/users.controller.ts
import type { Request, RequestHandler, Response } from 'express';
import { getAuth } from '../../http/middleware/authenticate';
import type { UpdateMeRequest, UserIdParams, UserSearchQuery } from './users.schema';
import type { UsersService } from './users.service';

type Valid = { body: unknown; query: unknown; params: unknown };
const valid = (res: Response) => (res.locals as { valid: Valid }).valid;

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export function usersController(service: UsersService) {
  return {
    search: handle(async (_req, res) => {
      const { q } = valid(res).query as UserSearchQuery;
      res.status(200).json({ items: await service.search(getAuth(res).userId, q) });
    }),

    updateMe: handle(async (_req, res) => {
      res.status(200).json(await service.updateMe(getAuth(res).userId, valid(res).body as UpdateMeRequest));
    }),

    block: handle(async (_req, res) => {
      await service.block(getAuth(res).userId, (valid(res).params as UserIdParams).userId);
      res.status(204).end();
    }),

    unblock: handle(async (_req, res) => {
      await service.unblock(getAuth(res).userId, (valid(res).params as UserIdParams).userId);
      res.status(204).end();
    }),
  };
}
