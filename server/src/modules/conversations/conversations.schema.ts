// server/src/modules/conversations/conversations.schema.ts — chỉ re-export hợp đồng từ @hustalo/shared
export {
  AddMembersRequestSchema,
  ConversationIdParamsSchema,
  ConversationListQuerySchema,
  ConversationMemberParamsSchema,
  CreateConversationRequestSchema,
  IdempotencyKeySchema,
  UpdateConversationRequestSchema,
  UpdateMemberRoleRequestSchema,
  type AddMembersRequest,
  type ConversationListQuery,
  type CreateConversationRequest,
  type UpdateConversationRequest,
  type UpdateMemberRoleRequest,
} from '@hustalo/shared';
