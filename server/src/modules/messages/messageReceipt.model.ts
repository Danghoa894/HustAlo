// server/src/modules/messages/messageReceipt.model.ts — database_schema.md §2.7 (chỉ DIRECT/SECRET; 1 bản ghi / tin / người nhận)
import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const messageReceiptSchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, required: true, ref: 'Message' },
    conversationId: { type: Schema.Types.ObjectId, required: true, ref: 'Conversation' },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    senderId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    messageCreatedAt: { type: Date, required: true },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'messageReceipts' },
);

messageReceiptSchema.index({ messageId: 1, userId: 1 }, { unique: true, name: 'message_user_unique' });
messageReceiptSchema.index({ conversationId: 1, userId: 1, messageCreatedAt: 1 }, { name: 'conv_user_created' });

export type MessageReceipt = InferSchemaType<typeof messageReceiptSchema>;
export const MessageReceiptModel = model('MessageReceipt', messageReceiptSchema);
