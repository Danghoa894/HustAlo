// server/src/modules/users/users.repository.ts — truy vấn users, userBlocks (database_schema.md §2.1, §2.3)
import { BLOCKED_LIST_MAX, UserStatus } from '@hustalo/shared';
import { Types } from 'mongoose';
import { UserModel } from './user.model';
import { UserBlockModel } from './userBlock.model';

export interface UserRecord {
  _id: Types.ObjectId;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  privacy: { showLastSeen: boolean };
  createdAt: Date;
}

export interface UserWithHash extends UserRecord {
  passwordHash: string;
}

const PUBLIC_FIELDS = 'email username displayName avatarUrl status privacy createdAt';

export const usersRepository = {
  findById: (id: string) => UserModel.findById(id).select(PUBLIC_FIELDS).lean<UserRecord>().exec(),

  findByEmailWithHash: (email: string) =>
    UserModel.findOne({ email }).select(`${PUBLIC_FIELDS} +passwordHash`).lean<UserWithHash>().exec(),

  findByIdWithHash: (id: string) =>
    UserModel.findById(id).select(`${PUBLIC_FIELDS} +passwordHash`).lean<UserWithHash>().exec(),

  async create(data: {
    email: string;
    username: string;
    passwordHash: string;
    displayName: string;
    displayNameNormalized: string;
  }): Promise<UserRecord> {
    const [doc] = await UserModel.create([data]);
    // Đọc lại bản lean có kiểu (InferSchemaType không suy được qua baseSchemaOptions dạng SchemaOptions).
    const created = await UserModel.findById(doc?._id).select(PUBLIC_FIELDS).lean<UserRecord>().exec();
    if (!created) throw new Error('Không đọc lại được user vừa tạo');
    return created;
  },

  setPasswordHash: (id: string, passwordHash: string, changedAt: Date | null) =>
    UserModel.updateOne(
      { _id: id },
      { $set: changedAt ? { passwordHash, passwordChangedAt: changedAt } : { passwordHash } },
    ).exec(),

  setStatus: (id: string, status: UserStatus) => UserModel.updateOne({ _id: id }, { $set: { status } }).exec(),

  updateProfile: (id: string, set: Record<string, unknown>) =>
    UserModel.findByIdAndUpdate(id, { $set: set }, { new: true }).select(PUBLIC_FIELDS).lean<UserRecord>().exec(),

  exists: async (id: string) => (await UserModel.exists({ _id: id })) !== null,

  /** Tìm theo tiền tố (regex anchored dùng index); loại `excludeIds` và user LOCKED. */
  searchPrefix(
    field: 'username' | 'displayNameNormalized',
    escapedPrefix: string,
    excludeIds: Types.ObjectId[],
    limit: number,
  ) {
    return UserModel.find({
      [field]: { $regex: `^${escapedPrefix}` },
      _id: { $nin: excludeIds },
      status: UserStatus.ACTIVE,
    })
      .select(PUBLIC_FIELDS)
      .limit(limit)
      .lean<UserRecord[]>()
      .exec();
  },

  findActiveByEmail: (email: string, excludeIds: Types.ObjectId[]) =>
    UserModel.find({ email, _id: { $nin: excludeIds }, status: UserStatus.ACTIVE })
      .select(PUBLIC_FIELDS)
      .limit(1)
      .lean<UserRecord[]>()
      .exec(),

  // ---- userBlocks ----
  async block(blockerId: string, blockedId: string): Promise<void> {
    try {
      await UserBlockModel.updateOne(
        { blockerId, blockedId },
        { $setOnInsert: { blockerId, blockedId } },
        { upsert: true },
      ).exec();
    } catch (err) {
      // Đua upsert → E11000 trên blocker_blocked_unique: coi như đã chặn.
      if (!(err instanceof Error && 'code' in err && err.code === 11000)) throw err;
    }
  },

  unblock: (blockerId: string, blockedId: string) => UserBlockModel.deleteOne({ blockerId, blockedId }).exec(),

  blockedIdsOf: async (blockerId: string) =>
    (
      await UserBlockModel.find({ blockerId })
        .select('blockedId')
        .sort({ createdAt: 1 })
        .limit(BLOCKED_LIST_MAX)
        .lean<{ blockedId: Types.ObjectId }[]>()
        .exec()
    ).map((b) => b.blockedId),

  /** Người đã chặn `userId` (dùng index blocked_blocker). */
  blockerIdsOf: async (userId: string) =>
    (
      await UserBlockModel.find({ blockedId: userId })
        .select('blockerId')
        .lean<{ blockerId: Types.ObjectId }[]>()
        .exec()
    ).map((b) => b.blockerId),

  blockedAmong: async (blockerId: string, ids: Types.ObjectId[]) =>
    (
      await UserBlockModel.find({ blockerId, blockedId: { $in: ids } })
        .select('blockedId')
        .lean<{ blockedId: Types.ObjectId }[]>()
        .exec()
    ).map((b) => String(b.blockedId)),

  isBlockedEitherWay: async (a: string, b: string) =>
    (await UserBlockModel.exists({
      $or: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    })) !== null,
};
