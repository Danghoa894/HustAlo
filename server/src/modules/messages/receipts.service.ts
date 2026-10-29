// server/src/modules/messages/receipts.service.ts — delivered/read một chiều (FR-CHAT-004; kiến trúc §7(b).1; DB §3, §4.5).
// - DIRECT/SECRET: receipt theo tin (messageReceipts) + cursor; phát message:status scope MESSAGE tới người gửi
//   (READ thêm tới user room người đọc để các device khác xóa badge — EC-MSG-014).
// - GROUP: chỉ cursor trên conversationMembers; phát GROUP_AGGREGATE tới room conv:{id} và user room người đọc.
// userId luôn lấy từ token: không thể gửi receipt thay người khác (EC-SEC-003). Không có API hạ cấp.
import { EVENTS } from '@hustalo/shared';
import type { Types } from 'mongoose';
import { AppError } from '../../http/errors/app-error';
import type { Emitter } from '../../realtime/emitter';
import { convRoom, userRoom } from '../../realtime/rooms';
import { messagesRepository as repo } from './messages.repository';
import type { ConversationsPort, CursorField, TupleCursorValue } from './messages.service';
import { messagesCore } from './messages.service';

export interface ReceiptsConversationsPort extends Pick<ConversationsPort, 'assertMember' | 'advanceCursors'> {
  /** Cursor hiện tại của một thành viên (null = chưa có). */
  memberCursors(
    conversationId: Types.ObjectId,
    userId: string,
  ): Promise<{ delivered: TupleCursorValue | null; read: TupleCursorValue | null }>;
}

export interface ReceiptsDeps {
  conversations: ReceiptsConversationsPort;
  emitter: Emitter;
}

export function createReceiptsService(deps: ReceiptsDeps) {
  const { conversations, emitter } = deps;

  async function mark(me: string, conversationId: string, upToMessageId: string, kind: 'DELIVERED' | 'READ') {
    const { conv } = await conversations.assertMember(conversationId, me);
    const msg = await repo.findInConversation(conv._id, upToMessageId);
    if (!msg) throw new AppError('NOT_FOUND', 'Không tìm thấy tin nhắn');
    const to = { at: msg.createdAt, id: msg._id };
    const fields: CursorField[] = kind === 'READ' ? ['Delivered', 'Read'] : ['Delivered'];
    const advanced = await conversations.advanceCursors(conv._id, me, to, fields);

    if (conv.type !== 'GROUP') {
      const rows = await repo.markReceipts(conv._id, me, msg.createdAt, kind === 'READ' ? 'readAt' : 'deliveredAt');
      if (rows.length > 0) {
        const payload = {
          conversationId: String(conv._id),
          scope: 'MESSAGE' as const,
          messageIds: rows.map((r) => String(r.messageId)),
          status: kind,
          byUserId: me,
          at: new Date().toISOString(),
        };
        const senders = [...new Set(rows.map((r) => String(r.senderId)))];
        const rooms = [...senders, ...(kind === 'READ' ? [me] : [])].map(userRoom);
        emitter.toRooms([...new Set(rooms)], EVENTS.MESSAGE_STATUS, payload);
      } else if (kind === 'READ' && advanced.includes('Read')) {
        // Không có receipt mới (vd. tin cuối là của mình) nhưng cursor đọc tiến → các device khác vẫn xóa badge.
        emitter.toUser(me, EVENTS.MESSAGE_STATUS, {
          conversationId: String(conv._id),
          scope: 'MESSAGE',
          messageIds: [],
          status: 'READ',
          byUserId: me,
          at: new Date().toISOString(),
        });
      }
      return { conv, advanced: advanced.length > 0 || rows.length > 0 };
    }

    if (advanced.length > 0) {
      const c = await conversations.memberCursors(conv._id, me);
      emitter.toRooms([convRoom(String(conv._id)), userRoom(me)], EVENTS.MESSAGE_STATUS, {
        conversationId: String(conv._id),
        scope: 'GROUP_AGGREGATE',
        userId: me,
        lastDeliveredMessageId: c.delivered ? String(c.delivered.id) : null,
        lastReadMessageId: c.read ? String(c.read.id) : null,
      });
    }
    return { conv, advanced: advanced.length > 0 };
  }

  return {
    async markDelivered(me: string, conversationId: string, upToMessageId: string) {
      const { advanced } = await mark(me, conversationId, upToMessageId, 'DELIVERED');
      return { advanced };
    },

    async markRead(me: string, conversationId: string, upToMessageId: string) {
      const { conv, advanced } = await mark(me, conversationId, upToMessageId, 'READ');
      const { read } = await conversations.memberCursors(conv._id, me);
      return { advanced, unreadCount: await messagesCore.countUnread(conv._id, me, read) };
    },
  };
}

export type ReceiptsService = ReturnType<typeof createReceiptsService>;
