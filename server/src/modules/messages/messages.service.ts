// server/src/modules/messages/messages.service.ts — tin nhắn (FR-CHAT-002/003/007/008/011, FR-SEC-002; kiến trúc §7(b)).
// - messagesCore: không phụ thuộc module khác — conversations gọi (createSystemMessage, previewsFor, countUnread,
//   textPreview; kiến trúc §5.2).
// - createMessagesService: gửi (transaction, ACK sau commit), lịch sử cursor, sửa/thu hồi 15 phút, DTO. Gọi conversations
//   và users qua port truyền vào (không import module khác → không vòng phụ thuộc).
import { EVENTS, MESSAGE_EDIT_WINDOW_MS, decodeCursor, encodeCursor } from '@hustalo/shared';
import type {
  Message,
  MessageHistoryQuery,
  MessagePage,
  MessageSendPayload,
  SystemPayload,
  UserPublic,
} from '@hustalo/shared';
import { Types, type ClientSession } from 'mongoose';
import type { z } from 'zod';
import { AppError } from '../../http/errors/app-error';
import { withTxn } from '../../infra/db/transaction';
import type { Emitter } from '../../realtime/emitter';
import { userRoom } from '../../realtime/rooms';
import { decryptContent, encryptContent } from './message.crypto';
import {
  messagesRepository as repo,
  type MessageRecord,
  type ReceiptRecord,
  type TupleCursorValue,
} from './messages.repository';

/** Tin cuối dùng dựng preview danh sách hội thoại (module khác chỉ thấy kiểu này, không thấy repository). */
export type MessagePreviewRecord = MessageRecord;
export type { TupleCursorValue };

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

/** Độ dài tối đa của preview TEXT (FR-CHAT-009): 100 code point đầu. */
const PREVIEW_CODE_POINTS = 100;

export const messagesCore = {
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
    await repo.insertSystem(
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

  /** Tin cuối của các hội thoại để dựng preview (FR-CHAT-009). */
  async previewsFor(ids: Types.ObjectId[]): Promise<Map<string, MessagePreviewRecord>> {
    if (ids.length === 0) return new Map();
    const docs = await repo.findByIds(ids);
    return new Map(docs.map((d) => [String(d._id), d]));
  },

  /** Preview TEXT: 100 code point đầu đã giải mã; thu hồi / SYSTEM / giải mã lỗi → null. */
  textPreview(m: MessagePreviewRecord): string | null {
    if (m.type !== 'TEXT' || m.deletedAt || !m.contentEnc) return null;
    const text = decryptContent(m.conversationId, m._id, m.contentEnc);
    return text === null ? null : Array.from(text).slice(0, PREVIEW_CODE_POINTS).join('');
  },

  /** DB §3.3 — đếm tối đa UNREAD_COUNT_CAP + 1 (UI hiển thị "99+"). */
  countUnread: (conversationId: Types.ObjectId, userId: string, readCursor: TupleCursorValue | null) =>
    repo.countUnread(conversationId, userId, readCursor),
};

export type MessagesCore = typeof messagesCore;

// ---- Port tới module khác (kiến trúc §5.2: messages → conversations, users) ----
export type CursorField = 'Delivered' | 'Read';

export interface ConversationsPort {
  /** AUTHZ-2: NOT_FOUND (chưa từng là thành viên / không tồn tại) hoặc NOT_A_MEMBER (đã rời). */
  assertMember(conversationId: string, userId: string): Promise<{ conv: { _id: Types.ObjectId; type: string } }>;
  activeMemberIds(conversationId: Types.ObjectId, session?: ClientSession): Promise<string[]>;
  touchLastMessage(
    conversationId: Types.ObjectId,
    last: { messageId: Types.ObjectId; senderId: Types.ObjectId; type: 'TEXT'; createdAt: Date },
    session: ClientSession,
  ): Promise<unknown>;
  advanceCursors(
    conversationId: Types.ObjectId,
    userId: string,
    to: TupleCursorValue,
    fields: CursorField[],
    session?: ClientSession,
  ): Promise<CursorField[]>;
}

export interface UsersPort {
  isBlockedEitherWay(a: string, b: string): Promise<boolean>;
  getPublicMany(ids: string[]): Promise<Map<string, { user: UserPublic; active: boolean }>>;
}

export interface MessagesDeps {
  conversations: ConversationsPort;
  users: UsersPort;
  emitter: Emitter;
  /** Chỉ test: chạy giữa bước 1 (insert) và 2 (re-check thành viên) của transaction gửi (TC-DB-007). */
  hooks?: { afterInsert?: () => Promise<void> };
}

const MSG = {
  notFound: 'Không tìm thấy tin nhắn',
  notMember: 'Bạn không còn là thành viên của cuộc trò chuyện này',
  blocked: 'Không thể gửi tin nhắn tới người này',
  kindMismatch: 'Loại tin không khớp loại cuộc trò chuyện',
  editWindow: 'Chỉ có thể sửa hoặc thu hồi tin trong 15 phút',
  badCursor: 'Cursor không hợp lệ',
} as const;

const isDuplicateKey = (err: unknown) =>
  err instanceof Error && 'code' in err && err.code === 11000 && err.message.includes('idempotency_unique');

function decodeTuple(s: string | undefined): TupleCursorValue | undefined {
  if (!s) return undefined;
  try {
    const c = decodeCursor(s);
    return { at: new Date(c.createdAt), id: new Types.ObjectId(c.id) };
  } catch {
    throw new AppError('VALIDATION_ERROR', MSG.badCursor);
  }
}

const cursorOf = (m: MessageRecord) => encodeCursor({ createdAt: m.createdAt.toISOString(), id: String(m._id) });

export function createMessagesService(deps: MessagesDeps) {
  const { conversations, users, emitter } = deps;

  /** DTO theo góc nhìn `viewerId`: tên người gửi / target hiện tại, `receipt` chỉ cho tin của chính mình (DIRECT/SECRET). */
  async function toDTOs(docs: MessageRecord[], viewerId: string): Promise<Message[]> {
    const nameIds = docs.flatMap((d) => [String(d.senderId), ...(d.system?.targetUserIds.map(String) ?? [])]);
    const mine = docs.filter((d) => String(d.senderId) === viewerId && d.type === 'TEXT').map((d) => d._id);
    const [profiles, receipts] = await Promise.all([users.getPublicMany(nameIds), repo.receiptsFor(mine)]);
    const receiptOf = new Map<string, ReceiptRecord>(receipts.map((r) => [String(r.messageId), r]));
    const ref = (id: Types.ObjectId) => ({
      id: String(id),
      displayName: profiles.get(String(id))?.user.displayName ?? '',
    });
    return docs.map((d) => {
      const r = String(d.senderId) === viewerId ? receiptOf.get(String(d._id)) : undefined;
      return {
        id: String(d._id),
        conversationId: String(d.conversationId),
        senderId: String(d.senderId),
        sender: ref(d.senderId),
        senderDeviceId: d.senderDeviceId,
        clientMessageId: d.clientMessageId,
        type: d.type,
        content: d.contentEnc && !d.deletedAt ? decryptContent(d.conversationId, d._id, d.contentEnc) : null,
        ciphertext: null, // SECRET (envelope theo device) ở M7
        system: d.system
          ? {
              kind: d.system.kind,
              actorId: String(d.system.actorId),
              targetUserIds: d.system.targetUserIds.map(String),
              targets: d.system.targetUserIds.map(ref),
              title: d.system.title,
              role: d.system.role,
              callId: d.system.callId ? String(d.system.callId) : null,
              callType: d.system.callType,
              durationSec: d.system.durationSec,
            }
          : null,
        receipt: r
          ? { deliveredAt: r.deliveredAt?.toISOString() ?? null, readAt: r.readAt?.toISOString() ?? null }
          : null,
        createdAt: d.createdAt.toISOString(),
        editedAt: d.editedAt?.toISOString() ?? null,
        deletedAt: d.deletedAt?.toISOString() ?? null,
      };
    });
  }

  const toDTO = async (doc: MessageRecord, viewerId: string) => {
    const [dto] = await toDTOs([doc], viewerId);
    if (!dto) throw new Error('toDTO rỗng');
    return dto;
  };

  /** Phát event tin tới user room mọi người tham gia; DTO riêng cho người gửi (có `receipt`). */
  async function fanOut(
    event: typeof EVENTS.MESSAGE_NEW | typeof EVENTS.MESSAGE_EDIT | typeof EVENTS.MESSAGE_DELETE,
    doc: MessageRecord,
    memberIds: string[],
  ) {
    const senderId = String(doc.senderId);
    const others = memberIds.filter((id) => id !== senderId);
    const [forSender, forOthers] = await Promise.all([
      memberIds.includes(senderId) ? toDTO(doc, senderId) : null,
      others.length > 0 ? toDTO(doc, others[0] ?? '') : null,
    ]);
    if (forSender) emitter.toUser(senderId, event, { message: forSender });
    if (forOthers) emitter.toRooms(others.map(userRoom), event, { message: forOthers });
  }

  /** Lấy tin + kiểm quyền: tin không tồn tại hoặc người gọi chưa từng là thành viên → NOT_FOUND (FR-SEC-008). */
  async function loadForAuthor(messageId: string, me: string) {
    const doc = await repo.findById(messageId);
    if (!doc) throw new AppError('NOT_FOUND', MSG.notFound);
    const { conv } = await conversations.assertMember(String(doc.conversationId), me);
    return { doc, conv };
  }

  const windowStart = (now: Date) => new Date(now.getTime() - MESSAGE_EDIT_WINDOW_MS);

  return {
    toDTOs,

    /** DB §4.4, kiến trúc §7(b): ACK chỉ sau commit; trùng clientMessageId → bản cũ, duplicate: true (EC-NET-004). */
    async send(auth: { userId: string; deviceId: string }, p: z.output<typeof MessageSendPayload>) {
      const me = auth.userId;
      const { conv } = await conversations.assertMember(p.conversationId, me);
      if (p.kind === 'PLAINTEXT' ? conv.type === 'SECRET' : conv.type !== 'SECRET') {
        throw new AppError('VALIDATION_ERROR', MSG.kindMismatch); // EC-MSG-016
      }
      if (p.kind === 'E2EE') throw new AppError('E2EE_KEYS_UNAVAILABLE', 'Trò chuyện bí mật chưa hỗ trợ'); // M7

      const _id = new Types.ObjectId();
      const createdAt = new Date();
      const senderId = new Types.ObjectId(me);
      let recipient: string | undefined;
      if (conv.type !== 'GROUP') {
        recipient = (await conversations.activeMemberIds(conv._id)).find((id) => id !== me);
        if (recipient && (await users.isBlockedEitherWay(me, recipient))) {
          throw new AppError('USER_BLOCKED', MSG.blocked); // AUTHZ-3, EC-MSG-011
        }
      }
      const contentEnc = encryptContent(conv._id, _id, p.content);

      let memberIds: string[];
      try {
        memberIds = await withTxn(async (session) => {
          await repo.insertText(
            {
              _id,
              conversationId: conv._id,
              senderId,
              senderDeviceId: auth.deviceId,
              clientMessageId: p.clientMessageId,
              createdAt,
              contentEnc,
            },
            session,
          );
          await deps.hooks?.afterInsert?.();
          const members = await conversations.activeMemberIds(conv._id, session); // re-check (EC-MSG-010)
          if (!members.includes(me)) throw new AppError('NOT_A_MEMBER', MSG.notMember);
          await conversations.touchLastMessage(
            conv._id,
            { messageId: _id, senderId, type: 'TEXT', createdAt },
            session,
          );
          if (recipient) {
            await repo.insertReceipt(
              {
                messageId: _id,
                conversationId: conv._id,
                userId: new Types.ObjectId(recipient),
                senderId,
                messageCreatedAt: createdAt,
              },
              session,
            );
          }
          await conversations.advanceCursors(conv._id, me, { at: createdAt, id: _id }, ['Delivered', 'Read'], session);
          return members;
        });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        const old = await repo.findByClientId(conv._id, me, p.clientMessageId);
        if (!old) throw err;
        return { message: await toDTO(old, me), duplicate: true };
      }

      const doc = await repo.findById(_id);
      if (!doc) throw new AppError('INTERNAL_ERROR', 'Không đọc lại được tin vừa gửi');
      await fanOut(EVENTS.MESSAGE_NEW, doc, memberIds);
      return { message: await toDTO(doc, me), duplicate: false };
    },

    /** FR-CHAT-003 (DB §4.2). */
    async history(me: string, conversationId: string, q: MessageHistoryQuery): Promise<MessagePage> {
      await conversations.assertMember(conversationId, me);
      const before = decodeTuple(q.before);
      const after = decodeTuple(q.after);
      const page = await repo.findPage(conversationId, {
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        limit: q.limit,
      });
      const first = page.items[0];
      const last = page.items.at(-1);
      return {
        items: await toDTOs(page.items, me),
        nextBefore: page.hasMoreBefore && first ? cursorOf(first) : null,
        nextAfter: page.hasMoreAfter && last ? cursorOf(last) : null,
      };
    },

    /** FR-CHAT-007: người gửi, ≤ 15 phút theo giờ server, không SYSTEM/thu hồi/SECRET; nội dung y hệt → không phát event. */
    async edit(me: string, messageId: string, content: string): Promise<Message> {
      const { doc, conv } = await loadForAuthor(messageId, me);
      const now = new Date();
      if (
        conv.type === 'SECRET' ||
        doc.type !== 'TEXT' ||
        doc.deletedAt ||
        String(doc.senderId) !== me ||
        doc.createdAt < windowStart(now)
      ) {
        throw new AppError('FORBIDDEN', MSG.editWindow);
      }
      if (doc.contentEnc && decryptContent(doc.conversationId, doc._id, doc.contentEnc) === content) {
        return toDTO(doc, me);
      }
      const ok = await repo.updateContent(
        doc._id,
        me,
        windowStart(now),
        encryptContent(conv._id, doc._id, content),
        now,
      );
      if (!ok) throw new AppError('FORBIDDEN', MSG.editWindow);
      const updated = await repo.findById(doc._id);
      if (!updated) throw new AppError('NOT_FOUND', MSG.notFound);
      await fanOut(EVENTS.MESSAGE_EDIT, updated, await conversations.activeMemberIds(conv._id));
      return toDTO(updated, me);
    },

    /** FR-CHAT-008: thu hồi với mọi người; lặp lại → trả bản hiện tại, không phát event. */
    async remove(me: string, messageId: string): Promise<Message> {
      const { doc, conv } = await loadForAuthor(messageId, me);
      if (doc.type !== 'TEXT' || String(doc.senderId) !== me) throw new AppError('FORBIDDEN', MSG.editWindow);
      if (doc.deletedAt) return toDTO(doc, me);
      const now = new Date();
      if (doc.createdAt < windowStart(now) || !(await repo.markDeleted(doc._id, me, windowStart(now), now))) {
        throw new AppError('FORBIDDEN', MSG.editWindow);
      }
      const updated = await repo.findById(doc._id);
      if (!updated) throw new AppError('NOT_FOUND', MSG.notFound);
      await fanOut(EVENTS.MESSAGE_DELETE, updated, await conversations.activeMemberIds(conv._id));
      return toDTO(updated, me);
    },
  };
}

export type MessagesService = ReturnType<typeof createMessagesService>;
