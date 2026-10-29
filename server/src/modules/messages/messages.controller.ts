// server/src/modules/messages/messages.controller.ts — lịch sử (FR-CHAT-003) và đánh dấu đã đọc qua REST (FR-CHAT-004)
import type { Request, RequestHandler, Response } from 'express';
import { getAuth } from '../../http/middleware/authenticate';
import type { MessageHistoryQuery, ReadRequest } from './messages.schema';
import type { MessagesService } from './messages.service';
import type { ReceiptsService } from './receipts.service';

type Valid = { body: unknown; query: unknown; params: unknown };
const valid = (res: Response) => (res.locals as { valid: Valid }).valid;
type ConvParams = { conversationId: string };

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export function messagesController(messages: MessagesService, receipts: ReceiptsService) {
  return {
    history: handle(async (_req, res) => {
      const { conversationId } = valid(res).params as ConvParams;
      res
        .status(200)
        .json(await messages.history(getAuth(res).userId, conversationId, valid(res).query as MessageHistoryQuery));
    }),

    read: handle(async (_req, res) => {
      const { conversationId } = valid(res).params as ConvParams;
      const { upToMessageId } = valid(res).body as ReadRequest;
      res.status(200).json(await receipts.markRead(getAuth(res).userId, conversationId, upToMessageId));
    }),
  };
}
