// server/src/modules/conversations/conversations.repository.ts — truy vấn conversations, conversationMembers
// (database_schema.md §2.4, §2.5, §4.1, §4.3, §4.7, §4.9)
import { GROUP_MAX_MEMBERS, type ConversationType, type MemberRole, type MessageType } from '@hustalo/shared';
import { Types, type ClientSession } from 'mongoose';
import { ConversationModel } from './conversation.model';
import { ConversationMemberModel } from './conversationMember.model';

export interface ConversationRecord {
  _id: Types.ObjectId;
  type: ConversationType;
  title: string | null;
  directKey: string | null;
  createdBy: Types.ObjectId;
  idempotencyKey: string | null;
  memberCount: number;
  lastMessage: {
    messageId: Types.ObjectId;
    senderId: Types.ObjectId | null;
    type: MessageType;
    createdAt: Date;
  } | null;
  lastMessageAt: Date;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberRecord {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: MemberRole;
  joinedAt: Date;
  leftAt: Date | null;
  lastDeliveredMessageId: Types.ObjectId | null;
  lastDeliveredMessageAt: Date | null;
  lastReadMessageId: Types.ObjectId | null;
  lastReadMessageAt: Date | null;
}

const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

export const conversationsRepository = {
  findById: (id: string | Types.ObjectId, session?: ClientSession) =>
    ConversationModel.findById(id)
      .session(session ?? null)
      .lean<ConversationRecord>()
      .exec(),

  findByDirectKey: (type: ConversationType, directKey: string) =>
    ConversationModel.findOne({ type, directKey }).lean<ConversationRecord>().exec(),

  findByIdempotencyKey: (createdBy: string, idempotencyKey: string) =>
    ConversationModel.findOne({ createdBy, idempotencyKey, type: 'GROUP' }).lean<ConversationRecord>().exec(),

  /** DB §4.3: upsert theo (type, directKey) — nguyên tử nhờ unique index; `created` = bản ghi vừa được chèn. */
  async upsertPair(type: 'DIRECT' | 'SECRET', directKey: string, createdBy: string) {
    // Xác minh với tài liệu chính thức của Mongoose 8: tùy chọn includeResultMetadata (thay rawResult).
    const res = (await ConversationModel.findOneAndUpdate(
      { type, directKey },
      { $setOnInsert: { type, directKey, createdBy: oid(createdBy), memberCount: 2, lastMessageAt: new Date() } },
      { upsert: true, new: true, includeResultMetadata: true, lean: true },
    ).exec()) as unknown as { value: ConversationRecord | null; lastErrorObject?: { upserted?: unknown } };
    const conv = res.value;
    if (!conv) throw new Error('upsertPair không trả về hội thoại');
    return { conv, created: Boolean(res.lastErrorObject?.upserted) };
  },

  async createGroup(
    doc: { title: string; createdBy: string; idempotencyKey: string; memberCount: number },
    session: ClientSession,
  ): Promise<Types.ObjectId> {
    const [created] = await ConversationModel.create(
      [
        {
          type: 'GROUP',
          title: doc.title,
          createdBy: oid(doc.createdBy),
          idempotencyKey: doc.idempotencyKey,
          memberCount: doc.memberCount,
        },
      ],
      { session },
    );
    if (!created) throw new Error('Không tạo được nhóm');
    return created._id;
  },

  async insertMembers(
    conversationId: Types.ObjectId,
    members: { userId: string; role: MemberRole; addedBy: string | null }[],
    session: ClientSession,
  ): Promise<void> {
    await ConversationMemberModel.insertMany(
      members.map((m) => ({
        conversationId,
        userId: oid(m.userId),
        role: m.role,
        addedBy: m.addedBy === null ? null : oid(m.addedBy),
      })),
      { session },
    );
  },

  /** Bản ghi thành viên (kể cả đã rời) — phân biệt NOT_FOUND / NOT_A_MEMBER (AUTHZ-2). */
  findMember: (conversationId: string | Types.ObjectId, userId: string, session?: ClientSession) =>
    ConversationMemberModel.findOne({ conversationId: oid(conversationId), userId: oid(userId) })
      .session(session ?? null)
      .lean<MemberRecord>()
      .exec(),

  activeMembers: (conversationId: string | Types.ObjectId, session?: ClientSession) =>
    ConversationMemberModel.find({ conversationId: oid(conversationId), leftAt: null })
      .sort({ joinedAt: 1, _id: 1 })
      .session(session ?? null)
      .lean<MemberRecord[]>()
      .exec(),

  activeMembershipsOf: (userId: string) =>
    ConversationMemberModel.find({ userId: oid(userId), leftAt: null })
      .select('conversationId lastDeliveredMessageId lastReadMessageId lastReadMessageAt role')
      .lean<
        Pick<
          MemberRecord,
          'conversationId' | 'lastDeliveredMessageId' | 'lastReadMessageId' | 'lastReadMessageAt' | 'role'
        >[]
      >()
      .exec(),

  /** Thành viên còn lại (khác `userId`) của các hội thoại DIRECT/SECRET — dựng `peer`. */
  otherMembers: (conversationIds: Types.ObjectId[], userId: string) =>
    ConversationMemberModel.find({ conversationId: { $in: conversationIds }, userId: { $ne: oid(userId) } })
      .select('conversationId userId')
      .lean<Pick<MemberRecord, 'conversationId' | 'userId'>[]>()
      .exec(),

  /** DB §4.1: trang hội thoại theo (lastMessageAt, _id) giảm dần, lấy `limit + 1` để biết còn trang sau. */
  page(userId: string, ids: Types.ObjectId[], cursor: { at: Date; id: Types.ObjectId } | null, limit: number) {
    const filter: Record<string, unknown> = {
      _id: { $in: ids },
      deletedAt: null,
      $or: [{ lastMessage: { $ne: null } }, { createdBy: oid(userId) }, { type: 'GROUP' }], // FR-CHAT-001
    };
    if (cursor) {
      filter.$and = [
        { $or: [{ lastMessageAt: { $lt: cursor.at } }, { lastMessageAt: cursor.at, _id: { $lt: cursor.id } }] },
      ];
    }
    return ConversationModel.find(filter)
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean<ConversationRecord[]>()
      .exec();
  },

  /**
   * DB §4.5: tiến cursor delivered/read của thành viên chỉ khi mốc mới lớn hơn (theo tuple thời gian, _id).
   * true = đã tiến (modifiedCount 1); không bao giờ lùi (AC-025, TC-DB-010).
   */
  async advanceCursor(
    id: Types.ObjectId,
    userId: string,
    field: 'Delivered' | 'Read',
    to: { at: Date; id: Types.ObjectId },
    session?: ClientSession,
  ): Promise<boolean> {
    const atKey = `last${field}MessageAt`;
    const idKey = `last${field}MessageId`;
    const res = await ConversationMemberModel.updateOne(
      {
        conversationId: id,
        userId: oid(userId),
        leftAt: null,
        $or: [{ [atKey]: null }, { [atKey]: { $lt: to.at } }, { [atKey]: to.at, [idKey]: { $lt: to.id } }],
      },
      { $set: { [atKey]: to.at, [idKey]: to.id } },
      session ? { session } : {},
    ).exec();
    return res.modifiedCount === 1;
  },

  /** DB §3.2: "đã xem bởi X/Y" cho một tin GROUP — thành viên hiện tại khác người gửi. */
  async groupReadStats(id: Types.ObjectId, msg: { _id: Types.ObjectId; createdAt: Date; senderId: Types.ObjectId }) {
    const base = { conversationId: id, leftAt: null, userId: { $ne: msg.senderId } };
    const reached = (f: 'Read' | 'Delivered') => ({
      ...base,
      $or: [
        { [`last${f}MessageAt`]: { $gt: msg.createdAt } },
        { [`last${f}MessageAt`]: msg.createdAt, [`last${f}MessageId`]: { $gte: msg._id } },
      ],
    });
    const [total, read, delivered] = await Promise.all([
      ConversationMemberModel.countDocuments(base).exec(),
      ConversationMemberModel.countDocuments(reached('Read')).exec(),
      ConversationMemberModel.countDocuments(reached('Delivered')).exec(),
    ]);
    return { total, read, delivered };
  },

  setTitle: (id: Types.ObjectId, title: string, session: ClientSession) =>
    ConversationModel.updateOne({ _id: id }, { $set: { title } }, { session }).exec(),

  /** Chỉ tiến về phía trước (DB §2.4). */
  setLastMessage: (
    id: Types.ObjectId,
    last: { messageId: Types.ObjectId; senderId: Types.ObjectId; type: MessageType; createdAt: Date },
    session: ClientSession,
  ) =>
    ConversationModel.updateOne(
      { _id: id, lastMessageAt: { $lte: last.createdAt } },
      { $set: { lastMessage: last, lastMessageAt: last.createdAt } },
      { session },
    ).exec(),

  /** DB §4.7: tăng memberCount có điều kiện; false → vượt GROUP_MAX_MEMBERS. */
  async incMemberCountIfRoom(id: Types.ObjectId, n: number, session: ClientSession): Promise<boolean> {
    const res = await ConversationModel.updateOne(
      { _id: id, type: 'GROUP', deletedAt: null, memberCount: { $lte: GROUP_MAX_MEMBERS - n } },
      { $inc: { memberCount: n } },
      { session },
    ).exec();
    return res.modifiedCount === 1;
  },

  decMemberCount: (id: Types.ObjectId, session: ClientSession) =>
    ConversationModel.updateOne(
      { _id: id, memberCount: { $gt: 1 } },
      { $inc: { memberCount: -1 } },
      { session },
    ).exec(),

  softDelete: (id: Types.ObjectId, session: ClientSession) =>
    ConversationModel.updateOne({ _id: id }, { $set: { deletedAt: new Date() } }, { session }).exec(),

  /** Đảm bảo hai người của DIRECT/SECRET là thành viên — idempotent (upsert theo conv_user_unique, không đổi bản đã có). */
  async ensurePairMembers(id: Types.ObjectId, userIds: [string, string]) {
    for (const userId of userIds) {
      await ConversationMemberModel.updateOne(
        { conversationId: id, userId: oid(userId) },
        { $setOnInsert: { conversationId: id, userId: oid(userId), role: 'MEMBER', joinedAt: new Date() } },
        { upsert: true },
      ).exec();
    }
  },

  /** Thêm mới hoặc thêm lại người đã rời, giữ cursor cũ (DB §2.5). */
  async upsertMembers(id: Types.ObjectId, userIds: string[], addedBy: string, session: ClientSession) {
    const now = new Date();
    // Tuần tự trong cùng transaction (tối đa GROUP_ADD_BATCH_MAX = 50); session không chạy song song được.
    for (const userId of userIds) {
      await ConversationMemberModel.updateOne(
        { conversationId: id, userId: oid(userId) },
        { $set: { leftAt: null, joinedAt: now, role: 'MEMBER', addedBy: oid(addedBy) } },
        { upsert: true, session },
      ).exec();
    }
  },

  /** `leftAt` cho thành viên đang tham gia; số bản ghi bị đổi (0 = không còn là thành viên). */
  async setLeft(id: Types.ObjectId, userId: string, session: ClientSession): Promise<number> {
    const res = await ConversationMemberModel.updateOne(
      { conversationId: id, userId: oid(userId), leftAt: null },
      { $set: { leftAt: new Date() } },
      { session },
    ).exec();
    return res.modifiedCount;
  },

  /** Đổi role có điều kiện role hiện tại (`from`); số bản ghi khớp/đổi. */
  async setRole(
    id: Types.ObjectId,
    userId: string,
    role: MemberRole,
    session: ClientSession,
    from?: MemberRole,
  ): Promise<{ matched: number; modified: number }> {
    const res = await ConversationMemberModel.updateOne(
      { conversationId: id, userId: oid(userId), leftAt: null, ...(from ? { role: from } : {}) },
      { $set: { role } },
      { session },
    ).exec();
    return { matched: res.matchedCount, modified: res.modifiedCount };
  },
};
