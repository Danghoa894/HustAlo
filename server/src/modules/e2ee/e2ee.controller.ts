// server/src/modules/e2ee/e2ee.controller.ts — /e2ee/* (api_spec tag E2EE; FR-E2EE-001..003, FR-E2EE-007)
import type { Request, RequestHandler, Response } from 'express';
import { getAuth } from '../../http/middleware/authenticate';
import type { RegisterDeviceKeysRequest, UploadPreKeysRequest } from './e2ee.schema';
import type { E2eeService } from './e2ee.service';

type Valid = { body: unknown; params: unknown };
const valid = (res: Response) => (res.locals as { valid: Valid }).valid;
const deviceParam = (res: Response) => (valid(res).params as { deviceId: string }).deviceId;

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export function e2eeController(e2ee: E2eeService) {
  return {
    listDevices: handle(async (_req, res) => {
      res.status(200).json(await e2ee.listDevices(getAuth(res)));
    }),

    revokeDevice: handle(async (_req, res) => {
      await e2ee.revokeDevice(getAuth(res), deviceParam(res));
      res.status(204).end();
    }),

    registerKeys: handle(async (_req, res) => {
      const body = valid(res).body as RegisterDeviceKeysRequest;
      res.status(200).json(await e2ee.registerDevice(getAuth(res), deviceParam(res), body));
    }),

    uploadPreKeys: handle(async (_req, res) => {
      const { oneTimePreKeys } = valid(res).body as UploadPreKeysRequest;
      res.status(200).json(await e2ee.uploadPreKeys(getAuth(res), deviceParam(res), oneTimePreKeys));
    }),

    identities: handle(async (_req, res) => {
      const { userId } = valid(res).params as { userId: string };
      res.status(200).json(await e2ee.getIdentities(getAuth(res), userId));
    }),

    bundles: handle(async (_req, res) => {
      const { userId } = valid(res).params as { userId: string };
      res.setHeader('Cache-Control', 'no-store'); // mỗi lần gọi tiêu thụ one-time prekey
      res.status(200).json(await e2ee.getBundles(getAuth(res), userId));
    }),
  };
}
