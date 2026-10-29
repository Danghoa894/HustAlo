// server/src/modules/messages/messages.service.ts — M2: createSystemMessage (FR-CHAT-011) và previewsFor cho danh sách
// hội thoại (DB §4.1). Gửi/lịch sử/sửa/thu hồi/receipt bổ sung ở M3.
import type { SystemPayload } from '@hustalo/shared';
import { Types, type ClientSession } from 'mongoose';
import { messagesRepository, type MessageRecord } from './messages.repository';

/** Tin cuối dùng dựng preview danh sách hội thoại (module khác chỉ thấy kiểu này, không thấy repository). */
export type MessagePreviewRecord = MessageRecord;

export interface SystemInput {
  kind: SystemPayload['kind'];
  actorId: string;
  targetUserIds?: string[];
  title?: string | null;
  role?: 'ADMIN' | 'MEMBER' | null;
}

export interface CreatedSystemMessage {
  id: Types.ObjectId;
  senderId: Types.ObjectId;
  createdAt: Date;
}

export const messagesService = {
  /**
   * Tạo tin SYSTEM trong transaction của người gọi. `senderId` = actor (DB §2.6). Người gọi (conversations) tự cập
   * nhật `lastMessage` của hội thoại trong cùng transaction.
   */
  async createSystemMessage(
    conversationId: string,
    input: SystemInput,
    session: ClientSession,
  ): Promise<CreatedSystemMessage> {
    const id = new Types.ObjectId();
    const senderId = new Types.ObjectId(input.actorId);
    const createdAt = new Date();
    await messagesRepository.insertSystem(
      {
        _id: id,
        conversationId: new Types.ObjectId(conversationId),
        senderId,
        createdAt,
        system: {
          kind: input.kind,
          actorId: senderId,
          targetUserIds: (input.targetUserIds ?? []).map((t) => new Types.ObjectId(t)),
          title: input.title ?? null,
          role: input.role ?? null,
          callId: null,
          callType: null,
          durationSec: null,
        },
      },
      session,
    );
    return { id, senderId, createdAt };
  },

  /** Tin cuối của các hội thoại để dựng preview (FR-CHAT-009). Preview TEXT (giải mã) bổ sung ở M3. */
  async previewsFor(ids: Types.ObjectId[]): Promise<Map<string, MessagePreviewRecord>> {
    if (ids.length === 0) return new Map();
    const docs = await messagesRepository.findByIds(ids);
    return new Map(docs.map((d) => [String(d._id), d]));
  },
};

export type MessagesService = typeof messagesService;
