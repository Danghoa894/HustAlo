// server/src/modules/conversations/conversations.controller.ts
import type { Request, RequestHandler, Response } from 'express';
import { getAuth } from '../../http/middleware/authenticate';
import {
  IdempotencyKeySchema,
  type AddMembersRequest,
  type ConversationListQuery,
  type CreateConversationRequest,
  type UpdateConversationRequest,
  type UpdateMemberRoleRequest,
} from './conversations.schema';
import type { ConversationsService } from './conversations.service';

type Valid = { body: unknown; query: unknown; params: unknown };
const valid = (res: Response) => (res.locals as { valid: Valid }).valid;
type ConvParams = { conversationId: string };
type MemberParams = { conversationId: string; userId: string };

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export function conversationsController(service: ConversationsService) {
  return {
    list: handle(async (_req, res) => {
      res.status(200).json(await service.list(getAuth(res).userId, valid(res).query as ConversationListQuery));
    }),

    /** Header Idempotency-Key bắt buộc cho mọi POST /conversations (FR-CHAT-001). DIRECT/SECRET: 201 tạo mới, 200 đã có. */
    create: handle(async (req, res) => {
      const key = IdempotencyKeySchema.parse(req.get('Idempotency-Key'));
      const me = getAuth(res).userId;
      const body = valid(res).body as CreateConversationRequest;
      const result =
        body.type === 'GROUP'
          ? await service.createGroup(me, body, key)
          : await service.createPair(body.type, me, body.memberIds[0] ?? '');
      res.status(result.created ? 201 : 200).json({ conversation: result.conversation, skipped: result.skipped });
    }),

    get: handle(async (_req, res) => {
      const { conversationId } = valid(res).params as ConvParams;
      res.status(200).json(await service.get(getAuth(res).userId, conversationId));
    }),

    rename: handle(async (_req, res) => {
      const { conversationId } = valid(res).params as ConvParams;
      const { title } = valid(res).body as UpdateConversationRequest;
      res.status(200).json(await service.rename(getAuth(res).userId, conversationId, title));
    }),

    addMembers: handle(async (_req, res) => {
      const { conversationId } = valid(res).params as ConvParams;
      const { userIds } = valid(res).body as AddMembersRequest;
      res.status(200).json(await service.addMembers(getAuth(res).userId, conversationId, userIds));
    }),

    changeRole: handle(async (_req, res) => {
      const { conversationId, userId } = valid(res).params as MemberParams;
      const { role } = valid(res).body as UpdateMemberRoleRequest;
      res.status(200).json(await service.changeRole(getAuth(res).userId, conversationId, userId, role));
    }),

    removeMember: handle(async (_req, res) => {
      const { conversationId, userId } = valid(res).params as MemberParams;
      await service.removeMember(getAuth(res).userId, conversationId, userId);
      res.status(204).end();
    }),
  };
}
