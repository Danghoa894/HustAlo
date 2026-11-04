// server/src/modules/messages/messages.repository.ts — truy vấn messages, messageReceipts
// (database_schema.md §2.6, §2.7, §3.3, §4.2, §4.4, §4.5; kiến trúc §9.2.4)
import { UNREAD_COUNT_CAP, type SystemPayload } from '@hustalo/shared';
import { Types, type ClientSession } from 'mongoose';
import type { EncryptedField } from '../../infra/crypto/aes-gcm';
import { tupleGt, tupleLt } from '../../infra/db/tuple';
import { MessageModel } from './message.model';
import { MessageReceiptModel } from './messageReceipt.model';

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
  senderDeviceId: string | null;
  clientMessageId: string | null;
  type: 'TEXT' | 'SYSTEM';
  contentEnc: EncryptedField | null;
  ciphertext: EnvelopeRecord | null;
  system: SystemRecord | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

/** Envelope SECRET lưu nguyên (DB §2.6, kiến trúc §9.3). */
export interface EnvelopeRecord {
  v: 1;
  senderDeviceId: string;
  recipients: { deviceId: string; type: 1 | 3; body: string }[];
}

export interface ReceiptRecord {
  messageId: Types.ObjectId;
  userId: Types.ObjectId;
  senderId: Types.ObjectId;
  deliveredAt: Date | null;
  readAt: Date | null;
}

export interface TupleCursorValue {
  at: Date;
  id: Types.ObjectId;
}

const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

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

  /** DB §4.4 bước 1: E11000 trên idempotency_unique → người gọi đọc bản cũ (duplicate). */
  async insertText(
    doc: {
      _id: Types.ObjectId;
      conversationId: Types.ObjectId;
      senderId: Types.ObjectId;
      senderDeviceId: string;
      clientMessageId: string;
      createdAt: Date;
    } & ({ contentEnc: EncryptedField } | { ciphertext: EnvelopeRecord }),
    session: ClientSession,
  ): Promise<void> {
    await MessageModel.create([{ ...doc, type: 'TEXT' }], { session });
  },

  findById: (id: string | Types.ObjectId) => MessageModel.findById(oid(id)).lean<MessageRecord>().exec(),

  findInConversation: (conversationId: string | Types.ObjectId, id: string | Types.ObjectId) =>
    MessageModel.findOne({ _id: oid(id), conversationId: oid(conversationId) })
      .lean<MessageRecord>()
      .exec(),

  findByClientId: (conversationId: Types.ObjectId, senderId: string, clientMessageId: string) =>
    MessageModel.findOne({ conversationId, senderId: oid(senderId), clientMessageId })
      .lean<MessageRecord>()
      .exec(),

  findByIds: (ids: Types.ObjectId[]) =>
    MessageModel.find({ _id: { $in: ids } })
      .lean<MessageRecord[]>()
      .exec(),

  /** DB §4.2: phân trang theo (createdAt, _id); không dùng skip. `items` trả tăng dần. */
  async findPage(conversationId: string, q: { before?: TupleCursorValue; after?: TupleCursorValue; limit: number }) {
    const base = { conversationId: oid(conversationId) };
    if (q.after) {
      const items = await MessageModel.find({ ...base, ...tupleGt(q.after.at, q.after.id) })
        .sort({ createdAt: 1, _id: 1 })
        .limit(q.limit + 1)
        .lean<MessageRecord[]>()
        .exec();
      return { items: items.slice(0, q.limit), hasMoreBefore: true, hasMoreAfter: items.length > q.limit };
    }
    const cond = q.before ? tupleLt(q.before.at, q.before.id) : {};
    const items = await MessageModel.find({ ...base, ...cond })
      .sort({ createdAt: -1, _id: -1 })
      .limit(q.limit + 1)
      .lean<MessageRecord[]>()
      .exec();
    return {
      items: items.slice(0, q.limit).reverse(),
      hasMoreBefore: items.length > q.limit,
      hasMoreAfter: Boolean(q.before),
    };
  },

  /** DB §2.6 quy tắc sửa: điều kiện người gửi, chưa thu hồi, TEXT, trong cửa sổ — matched 0 → người gọi phân loại lỗi. */
  async updateContent(id: Types.ObjectId, senderId: string, since: Date, contentEnc: EncryptedField, now: Date) {
    const res = await MessageModel.updateOne(
      { _id: id, senderId: oid(senderId), deletedAt: null, type: 'TEXT', createdAt: { $gte: since } },
      { $set: { contentEnc, editedAt: now } },
    ).exec();
    return res.matchedCount === 1;
  },

  /** DB §2.6 quy tắc thu hồi: pipeline giữ `deletedAt` cũ khi thu hồi lặp (idempotent). */
  async markDeleted(id: Types.ObjectId, senderId: string, since: Date, now: Date) {
    const res = await MessageModel.updateOne(
      { _id: id, senderId: oid(senderId), type: 'TEXT', createdAt: { $gte: since } },
      [{ $set: { deletedAt: { $ifNull: ['$deletedAt', now] }, contentEnc: null, ciphertext: null } }],
    ).exec();
    return res.matchedCount === 1;
  },

  /** DB §3.3: tin của người khác, chưa thu hồi, TEXT hoặc CALL_MISSED, sau read cursor; đếm tối đa 100. */
  countUnread: (conversationId: Types.ObjectId, userId: string, after: TupleCursorValue | null) =>
    MessageModel.countDocuments(
      {
        conversationId,
        senderId: { $ne: oid(userId) },
        deletedAt: null,
        $and: [
          { $or: [{ type: 'TEXT' }, { 'system.kind': 'CALL_MISSED' }] },
          ...(after ? [tupleGt(after.at, after.id)] : []),
        ],
      },
      { limit: UNREAD_COUNT_CAP + 1 },
    ).exec(),

  // ---- messageReceipts (DIRECT/SECRET) ----
  async insertReceipt(
    doc: {
      messageId: Types.ObjectId;
      conversationId: Types.ObjectId;
      userId: Types.ObjectId;
      senderId: Types.ObjectId;
      messageCreatedAt: Date;
    },
    session: ClientSession,
  ): Promise<void> {
    await MessageReceiptModel.create([doc], { session });
  },

  receiptsFor: (messageIds: Types.ObjectId[]) =>
    messageIds.length === 0
      ? Promise.resolve<ReceiptRecord[]>([])
      : MessageReceiptModel.find({ messageId: { $in: messageIds } })
          .select('messageId userId senderId deliveredAt readAt')
          .lean<ReceiptRecord[]>()
          .exec(),

  /**
   * DB §4.5: đánh dấu receipt của `userId` tới mốc `upTo` (theo messageCreatedAt). Không bao giờ hạ cấp: chỉ đổi bản
   * ghi còn null; read đồng thời đặt deliveredAt bằng $ifNull. Trả các bản ghi thực sự đổi (để phát message:status).
   */
  async markReceipts(conversationId: Types.ObjectId, userId: string, upTo: Date, field: 'deliveredAt' | 'readAt') {
    const filter = { conversationId, userId: oid(userId), [field]: null, messageCreatedAt: { $lte: upTo } };
    const rows = await MessageReceiptModel.find(filter)
      .select('messageId senderId')
      .lean<Pick<ReceiptRecord, 'messageId' | 'senderId'>[]>()
      .exec();
    if (rows.length === 0) return [];
    const now = new Date();
    const set =
      field === 'readAt' ? { readAt: now, deliveredAt: { $ifNull: ['$deliveredAt', now] } } : { deliveredAt: now };
    await MessageReceiptModel.updateMany({ ...filter, messageId: { $in: rows.map((r) => r.messageId) } }, [
      { $set: set },
    ]).exec();
    return rows;
  },

  // ---- job re-encrypt (kiến trúc §9.2.4) ----
  batchByKeyId: (keyId: string, after: Types.ObjectId | null, limit: number) =>
    MessageModel.find({ 'contentEnc.keyId': keyId, ...(after ? { _id: { $gt: after } } : {}) })
      .sort({ _id: 1 })
      .limit(limit)
      .select('conversationId contentEnc')
      .lean<Pick<MessageRecord, '_id' | 'conversationId' | 'contentEnc'>[]>()
      .exec(),

  /** Điều kiện `iv` cũ: tin vừa được sửa đồng thời (IV mới) không bị ghi đè. */
  async replaceContentEnc(id: Types.ObjectId, fromKeyId: string, oldIv: string, contentEnc: EncryptedField) {
    const res = await MessageModel.updateOne(
      { _id: id, 'contentEnc.keyId': fromKeyId, 'contentEnc.iv': oldIv },
      { $set: { contentEnc } },
    ).exec();
    return res.modifiedCount === 1;
  },

  countByKeyId: (keyId: string) => MessageModel.countDocuments({ 'contentEnc.keyId': keyId }).exec(),
};
