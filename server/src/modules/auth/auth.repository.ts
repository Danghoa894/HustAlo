// server/src/modules/auth/auth.repository.ts — refreshSessions (Mongo) + session:revoked:{sid} (Redis)
// (database_schema.md §2.2, Phụ lục A kiến trúc). Không có quy tắc nghiệp vụ.
import { ACCESS_TOKEN_TTL_S, type SessionRevokeReason } from '@hustalo/shared';
import { Types, type ClientSession } from 'mongoose';
import { keys } from '../../infra/redis/keys';
import type { RedisHandle } from '../../infra/redis/redis';
import { RefreshSessionModel } from './refreshSession.model';

export interface RefreshGeneration {
  _id: Types.ObjectId;
  familyId: Types.ObjectId;
  userId: Types.ObjectId;
  deviceId: string;
  tokenHash: string;
  parentHash: string | null;
  replacedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  expiresAt: Date;
}

export interface NewGeneration {
  familyId: Types.ObjectId;
  userId: Types.ObjectId;
  deviceId: string;
  tokenHash: string;
  parentHash: string | null;
  expiresAt: Date;
  userAgent: string;
  ip: string;
}

export function createAuthRepository(redis: RedisHandle) {
  return {
    async createGeneration(data: NewGeneration, session?: ClientSession): Promise<void> {
      await RefreshSessionModel.create([data], session ? { session } : {});
    },

    findByTokenHash: (tokenHash: string) =>
      RefreshSessionModel.findOne({ tokenHash }).select('+tokenHash +parentHash').lean<RefreshGeneration>().exec(),

    /** Chỉ xoay khi chưa bị xoay/thu hồi; modifiedCount = 0 → tab khác vừa xoay (D-19). */
    async markReplaced(id: Types.ObjectId, now: Date, session: ClientSession): Promise<boolean> {
      const res = await RefreshSessionModel.updateOne(
        { _id: id, replacedAt: null, revokedAt: null },
        { $set: { replacedAt: now } },
        { session },
      ).exec();
      return res.modifiedCount === 1;
    },

    /** Thế hệ con còn hiện hành của `parentHash` (điều kiện grace, database_schema.md §2.2). */
    hasCurrentChild: async (familyId: Types.ObjectId, parentHash: string) =>
      (await RefreshSessionModel.exists({ familyId, parentHash, replacedAt: null, revokedAt: null })) !== null,

    async revokeFamilies(familyIds: Types.ObjectId[], reason: SessionRevokeReason, now: Date): Promise<void> {
      if (familyIds.length === 0) return;
      await RefreshSessionModel.updateMany(
        { familyId: { $in: familyIds }, revokedAt: null },
        { $set: { revokedAt: now, revokeReason: reason } },
      ).exec();
    },

    /** familyId còn hoạt động của user (lọc theo device / loại trừ một family). Index user_device_active. */
    activeFamilyIds: async (filter: { userId: Types.ObjectId; deviceId?: string; exceptFamilyId?: Types.ObjectId }) =>
      (await RefreshSessionModel.distinct('familyId', {
        userId: filter.userId,
        ...(filter.deviceId === undefined ? {} : { deviceId: filter.deviceId }),
        ...(filter.exceptFamilyId === undefined ? {} : { familyId: { $ne: filter.exceptFamilyId } }),
        revokedAt: null,
      }).exec()) as Types.ObjectId[],

    isFamilyRevokedInDb: async (familyId: string) =>
      (await RefreshSessionModel.exists({ familyId, revokedAt: { $ne: null } })) !== null,

    // ---- Redis session:revoked:{sid} ----
    async markRevoked(sid: string, reason: SessionRevokeReason): Promise<void> {
      try {
        await redis.client.set(keys.sessionRevoked(sid), reason, 'EX', ACCESS_TOKEN_TTL_S);
      } catch {
        // Redis down: Mongo (revokedAt) vẫn là nguồn sự thật; kiểm tra fallback ở isRevoked (kiến trúc §10.2).
      }
    },

    /** Redis EXISTS; Redis lỗi → tra revokedAt của family trong Mongo (kiến trúc §10.2). */
    async isRevoked(sid: string): Promise<boolean> {
      if (redis.isHealthy()) {
        try {
          return (await redis.client.exists(keys.sessionRevoked(sid))) === 1;
        } catch {
          // rơi xuống fallback
        }
      }
      return this.isFamilyRevokedInDb(sid);
    },

    async publishUserLocked(userId: string): Promise<void> {
      await redis.client.publish(keys.opsUserLocked(), JSON.stringify({ userId }));
    },
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
