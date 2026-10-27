// server/src/modules/users/users.service.ts — search, updateMe, block/unblock, isBlockedEitherWay, và các hàm
// auth được phép gọi (findByEmail, create, setPassword, lock — kiến trúc §5.2)
import {
  USER_SEARCH_LIMIT,
  UserStatus,
  normalizeForSearch,
  type UpdateMeRequest,
  type UserMe,
  type UserPublic,
} from '@hustalo/shared';
import { Types } from 'mongoose';
import { AppError } from '../../http/errors/app-error';
import { usersRepository, type UserRecord } from './users.repository';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const toUserPublic = (u: UserRecord): UserPublic => ({
  id: String(u._id),
  username: u.username,
  displayName: u.displayName,
  avatarUrl: u.avatarUrl ?? null,
});

async function toUserMe(u: UserRecord): Promise<UserMe> {
  const blocked = await usersRepository.blockedIdsOf(String(u._id));
  return {
    id: String(u._id),
    email: u.email,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl ?? null,
    privacy: { showLastSeen: u.privacy.showLastSeen },
    blockedUserIds: blocked.map(String),
    createdAt: u.createdAt.toISOString(),
  };
}

const isDuplicateKey = (err: unknown): err is Error & { keyPattern?: Record<string, unknown> } =>
  err instanceof Error && 'code' in err && err.code === 11000;

export const usersService = {
  findByEmailWithHash: (email: string) => usersRepository.findByEmailWithHash(email),
  findByIdWithHash: (id: string) => usersRepository.findByIdWithHash(id),
  findById: (id: string) => usersRepository.findById(id),

  /** E11000 trên email_unique/username_unique → 409 CONFLICT với details.field (EC-AUTH-001). */
  async create(data: { email: string; username: string; passwordHash: string; displayName: string }) {
    try {
      return await usersRepository.create({ ...data, displayNameNormalized: normalizeForSearch(data.displayName) });
    } catch (err) {
      if (isDuplicateKey(err)) {
        const field = err.keyPattern && 'username' in err.keyPattern ? 'username' : 'email';
        const message = field === 'email' ? 'Email này đã được sử dụng' : 'Tên người dùng đã tồn tại';
        throw new AppError('CONFLICT', message, { field });
      }
      throw err;
    }
  },

  setPassword: (userId: string, passwordHash: string, changedAt: Date | null) =>
    usersRepository.setPasswordHash(userId, passwordHash, changedAt),

  setStatus: (userId: string, status: UserStatus) => usersRepository.setStatus(userId, status),

  async getMe(userId: string): Promise<UserMe> {
    const user = await usersRepository.findById(userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ');
    return toUserMe(user);
  },

  toUserMe,

  async updateMe(userId: string, body: UpdateMeRequest): Promise<UserMe> {
    const set: Record<string, unknown> = {};
    if (body.displayName !== undefined) {
      set.displayName = body.displayName;
      set.displayNameNormalized = normalizeForSearch(body.displayName);
    }
    if (body.avatarUrl !== undefined) set.avatarUrl = body.avatarUrl;
    if (body.privacy !== undefined) set['privacy.showLastSeen'] = body.privacy.showLastSeen;
    const user = await usersRepository.updateProfile(userId, set);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ');
    return toUserMe(user);
  },

  /**
   * FR-USER-001: email chính xác (q chứa @) hoặc tiền tố username / displayName đã bỏ dấu.
   * Loại chính mình, user LOCKED, người đã chặn mình; người mình chặn có blockedByMe: true.
   * Thứ hạng: username trùng hoàn toàn → tiền tố username → tiền tố displayName; cùng hạng theo displayName.
   */
  async search(meId: string, q: string): Promise<UserPublic[]> {
    const exclude = [new Types.ObjectId(meId), ...(await usersRepository.blockerIdsOf(meId))];
    let ranked: { user: UserRecord; rank: number }[];
    if (q.includes('@')) {
      const found = await usersRepository.findActiveByEmail(q.toLowerCase(), exclude);
      ranked = found.map((user) => ({ user, rank: 0 }));
    } else {
      const lower = q.toLowerCase();
      const [byUsername, byName] = await Promise.all([
        usersRepository.searchPrefix('username', escapeRegExp(lower), exclude, USER_SEARCH_LIMIT),
        usersRepository.searchPrefix('displayNameNormalized', escapeRegExp(normalizeForSearch(q)), exclude, USER_SEARCH_LIMIT),
      ]);
      const seen = new Map<string, { user: UserRecord; rank: number }>();
      for (const user of byUsername) seen.set(String(user._id), { user, rank: user.username === lower ? 0 : 1 });
      for (const user of byName) if (!seen.has(String(user._id))) seen.set(String(user._id), { user, rank: 2 });
      ranked = [...seen.values()];
    }
    ranked.sort((a, b) => a.rank - b.rank || a.user.displayName.localeCompare(b.user.displayName, 'vi'));
    const page = ranked.slice(0, USER_SEARCH_LIMIT).map((r) => r.user);
    const blockedByMe = new Set(await usersRepository.blockedAmong(meId, page.map((u) => u._id)));
    return page.map((u) => ({ ...toUserPublic(u), blockedByMe: blockedByMe.has(String(u._id)) }));
  },

  /** Chặn chính mình → VALIDATION_ERROR; user không tồn tại → NOT_FOUND; idempotent. */
  async block(meId: string, targetId: string): Promise<void> {
    if (meId === targetId) throw new AppError('VALIDATION_ERROR', 'Không thể chặn chính mình');
    if (!(await usersRepository.exists(targetId))) throw new AppError('NOT_FOUND', 'Không tìm thấy người dùng');
    await usersRepository.block(meId, targetId);
  },

  async unblock(meId: string, targetId: string): Promise<void> {
    if (meId === targetId) throw new AppError('VALIDATION_ERROR', 'Không thể bỏ chặn chính mình');
    if (!(await usersRepository.exists(targetId))) throw new AppError('NOT_FOUND', 'Không tìm thấy người dùng');
    await usersRepository.unblock(meId, targetId);
  },

  isBlockedEitherWay: (a: string, b: string) => usersRepository.isBlockedEitherWay(a, b),
};

export type UsersService = typeof usersService;
