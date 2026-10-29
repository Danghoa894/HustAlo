// server/src/modules/conversations/conversationMember.model.ts — database_schema.md §2.5.
// Cursor receipt (lastDelivered*, lastRead*) thuộc quyền ghi của module messages (kiến trúc §5.1, M3).
import { MemberRole } from '@hustalo/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from '../../infra/db/schema-options';

const conversationMemberSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true, ref: 'Conversation' },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    role: { type: String, required: true, enum: Object.values(MemberRole), default: MemberRole.MEMBER },
    joinedAt: { type: Date, required: true, default: () => new Date() },
    leftAt: { type: Date, default: null },
    addedBy: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
    lastDeliveredMessageId: { type: Schema.Types.ObjectId, default: null, ref: 'Message' },
    lastDeliveredMessageAt: { type: Date, default: null },
    lastReadMessageId: { type: Schema.Types.ObjectId, default: null, ref: 'Message' },
    lastReadMessageAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, collection: 'conversationMembers' },
);

conversationMemberSchema.index({ conversationId: 1, userId: 1 }, { unique: true, name: 'conv_user_unique' });
conversationMemberSchema.index({ userId: 1, leftAt: 1, conversationId: 1 }, { name: 'user_active' });
conversationMemberSchema.index({ conversationId: 1, leftAt: 1, role: 1 }, { name: 'conv_active_role' });

export type ConversationMember = InferSchemaType<typeof conversationMemberSchema>;
export const ConversationMemberModel = model('ConversationMember', conversationMemberSchema);
