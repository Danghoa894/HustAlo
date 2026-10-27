// server/src/http/middleware/request-id.ts — X-Request-Id: nhận UUID hợp lệ từ client hoặc sinh mới
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Dùng làm `genReqId` của pino-http: gán header response và trả id cho `req.id`. */
export function genRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && UUID.test(incoming) ? incoming.toLowerCase() : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}
