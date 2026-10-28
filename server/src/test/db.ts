// server/src/test/db.ts — đọc/ghi DB trực tiếp cho assertion của integration test.
// Test trong modules/<m>/ không import model của module khác (AC-ARCH-001) → truy cập chéo module đi qua đây.
import type { UserStatus } from '@hustalo/shared';
import { RefreshSessionModel, type RefreshSession } from '../modules/auth/refreshSession.model';
import { UserModel, type User } from '../modules/users/user.model';

type UserFilter = { id: string } | { email: string };
const userQuery = (f: UserFilter) => ('id' in f ? { _id: f.id } : { email: f.email });

export const testDb = {
  /** `select` dạng mongoose, vd '+passwordHash' để lấy trường select:false. */
  findUser: (f: UserFilter, select = '') => UserModel.findOne(userQuery(f)).select(select).lean<User>().exec(),
  countUsers: (f: UserFilter) => UserModel.countDocuments(userQuery(f)).exec(),
  setUserStatus: async (id: string, status: UserStatus) => {
    await UserModel.updateOne({ _id: id }, { $set: { status } }).exec();
  },
  findRefreshSession: (userId: string, select = '') =>
    RefreshSessionModel.findOne({ userId }).select(select).lean<RefreshSession>().exec(),
};
