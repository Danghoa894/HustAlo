// server/src/modules/messages/messages.schema.ts — chỉ re-export hợp đồng từ @hustalo/shared
export {
  ConversationIdParamsSchema,
  MessageDeletePayload,
  MessageEditPayload,
  MessageHistoryQuerySchema,
  MessageSendPayload,
  ReadRequestSchema,
  ReceiptCursorPayload,
  type MessageHistoryQuery,
  type ReadRequest,
} from '@hustalo/shared';
