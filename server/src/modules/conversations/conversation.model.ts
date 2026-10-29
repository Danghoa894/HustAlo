// server/src/modules/conversations/conversation.model.ts — database_schema.md §2.4
import { ConversationType, GROUP_MAX_MEMBERS, GROUP_TITLE_MAX, MessageType } from '@hustalo/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const lastMessageSchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, required: true, ref: 'Message' },
    senderId: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
    type: { type: String, required: true, enum: Object.values(MessageType) },
    createdAt: { type: Date, required: true },
  },
  { _id: false, strict: 'throw' },
);

const conversationSchema = new Schema(
  {
    type: { type: String, required: true, enum: Object.values(ConversationType) },
    title: {
      type: String,
      default: null,
      trim: true,
      maxlength: GROUP_TITLE_MAX * 2,
      required: [
        function (this: { type: string }) {
          return this.type === 'GROUP';
        },
        'GROUP cần title',
      ],
    },
    directKey: {
      type: String,
      default: null,
      match: /^[a-f0-9]{24}:[a-f0-9]{24}$/,
      required: [
        function (this: { type: string }) {
          return this.type !== 'GROUP';
        },
        'DIRECT/SECRET cần directKey',
      ],
    },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    idempotencyKey: { type: String, default: null, maxlength: 36 },
    memberCount: { type: Number, required: true, min: 1, max: GROUP_MAX_MEMBERS },
    lastMessage: { type: lastMessageSchema, default: null },
    lastMessageAt: { type: Date, required: true, default: () => new Date() },
    deletedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'conversations' },
);

conversationSchema.index(
  { type: 1, directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: 'string' } }, name: 'type_directKey_unique' },
);
conversationSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } }, name: 'creator_idem_unique' },
);
conversationSchema.index({ lastMessageAt: -1, _id: -1 }, { name: 'lastMessageAt_id' });

export type Conversation = InferSchemaType<typeof conversationSchema>;
export const ConversationModel = model('Conversation', conversationSchema);

export function directKeyOf(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
