// server/src/modules/messages/messages.repository.ts — truy vấn messages (database_schema.md §2.6)
import type { SystemPayload } from '@hustalo/shared';
import { Types, type ClientSession } from 'mongoose';
import { MessageModel } from './message.model';

export interface SystemRecord {
  kind: SystemPayload['kind'];
  actorId: Types.ObjectId;
  targetUserIds: Types.ObjectId[];
  title: string | null;
  role: 'ADMIN' | 'MEMBER' | null;
  callId: Types.ObjectId | null;
  callType: 'VOICE' | 'VIDEO' | null;
  durationSec: number | null;
}

export interface MessageRecord {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  type: 'TEXT' | 'SYSTEM';
  system: SystemRecord | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export const messagesRepository = {
  async insertSystem(
    doc: {
      _id: Types.ObjectId;
      conversationId: Types.ObjectId;
      senderId: Types.ObjectId;
      createdAt: Date;
      system: object;
    },
    session: ClientSession,
  ): Promise<void> {
    await MessageModel.create([{ ...doc, type: 'SYSTEM' }], { session });
  },

  findByIds: (ids: Types.ObjectId[]) =>
    MessageModel.find({ _id: { $in: ids } })
      .select('conversationId senderId type system deletedAt createdAt')
      .lean<MessageRecord[]>()
      .exec(),
};
