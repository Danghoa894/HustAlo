// server/src/modules/auth/auth.service.ts — register, login, rotateRefresh, logout, changePassword, revokeFamily,
// lockUser (kiến trúc §7(a), D-19; PRD FR-AUTH-001..006)
import {
  REFRESH_REUSE_GRACE_S,
  REFRESH_TOKEN_TTL_S,
  SessionRevokeReason,
  UserStatus,
  type AuthResponse,
  type ChangePasswordRequest,
  type LoginRequest,
  type RegisterRequest,
} from '@hustalo/shared';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { hashPassword, needsRehash, verifyDummy, verifyPassword } from '../../infra/crypto/password';
import { hmacSha256, randomToken } from '../../infra/crypto/random';
import { withTxn } from '../../infra/db/transaction';
import { signAccessToken } from '../../infra/jwt/jwt';
import { AppError } from '../../http/errors/app-error';
import { usersService } from '../users/users.service';
import type { AuthRepository, RefreshGeneration } from './auth.repository';

export const INVALID_CREDENTIALS = 'Email hoặc mật khẩu không đúng';

/** Phát session:revoked + ngắt socket của session (realtime/handlers/session.handler.ts hiện thực). */
export interface SessionNotifier {
  sessionRevoked(sid: string, reason: SessionRevokeReason): void;
}

/** Kết thúc cuộc gọi của session khi logout/thu hồi (calls.endCallsForSession, M5). M1: no-op. */
export interface CallTerminator {
  endCallsForSession(sid: string): Promise<void>;
}

export interface RequestMeta {
  ip: string;
  userAgent: string;
}

/** Kết quả cấp phiên: body AuthResponse + giá trị cookie (controller set cookie). */
export interface IssuedSession {
  body: AuthResponse;
  refreshToken: string;
  csrfToken?: string;
}

export type RefreshDecision = 'ROTATE' | 'GRACE_CONFLICT' | 'REUSE' | 'INVALID';

/**
 * Kiến trúc §7(a): A ROTATE (token hiện hành), B GRACE_CONFLICT (vừa xoay ≤ 10 s và con còn hiện hành),
 * C REUSE (đã xoay ngoài grace / tổ tiên xa hơn), D INVALID (không tìm thấy, hết hạn, family đã thu hồi).
 */
export function decideRefresh(
  gen: Pick<RefreshGeneration, 'replacedAt' | 'revokedAt' | 'expiresAt'> | null,
  now: Date,
  hasCurrentChild: boolean,
): RefreshDecision {
  if (!gen || gen.revokedAt !== null || gen.expiresAt.getTime() <= now.getTime()) return 'INVALID';
  if (gen.replacedAt === null) return 'ROTATE';
  const sinceReplacedMs = now.getTime() - gen.replacedAt.getTime();
  if (sinceReplacedMs <= REFRESH_REUSE_GRACE_S * 1000 && hasCurrentChild) return 'GRACE_CONFLICT';
  return 'REUSE';
}

const sessionInvalid = () => new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ');

export interface AuthServiceDeps {
  repo: AuthRepository;
  notifier: SessionNotifier;
  calls?: CallTerminator;
  now?: () => Date;
}

export function createAuthService(deps: AuthServiceDeps) {
  const { repo, notifier } = deps;
  const now = deps.now ?? (() => new Date());
  const calls: CallTerminator = deps.calls ?? { endCallsForSession: () => Promise.resolve() };
  const hashToken = (token: string) => hmacSha256(env.REFRESH_TOKEN_PEPPER, token);

  async function revokeFamilies(familyIds: Types.ObjectId[], reason: SessionRevokeReason): Promise<void> {
    if (familyIds.length === 0) return;
    await repo.revokeFamilies(familyIds, reason, now());
    for (const familyId of familyIds) {
      const sid = String(familyId);
      await repo.markRevoked(sid, reason);
      await calls.endCallsForSession(sid);
      notifier.sessionRevoked(sid, reason);
    }
  }

  async function issue(
    userId: Types.ObjectId,
    deviceId: string,
    meta: RequestMeta,
    opts: { familyId?: Types.ObjectId; parentHash?: string | null; withCsrf: boolean },
  ): Promise<{ refreshToken: string; csrfToken?: string; familyId: Types.ObjectId }> {
    const refreshToken = randomToken(32);
    const familyId = opts.familyId ?? new Types.ObjectId();
    await repo.createGeneration({
      familyId,
      userId,
      deviceId,
      tokenHash: hashToken(refreshToken),
      parentHash: opts.parentHash ?? null,
      expiresAt: new Date(now().getTime() + REFRESH_TOKEN_TTL_S * 1000),
      userAgent: meta.userAgent.slice(0, 512),
      ip: meta.ip.slice(0, 45),
    });
    return { refreshToken, familyId, ...(opts.withCsrf ? { csrfToken: randomToken(32) } : {}) };
  }

  async function authBody(userId: string, sid: string, deviceId: string): Promise<AuthResponse> {
    const [{ token, expiresAt }, user] = await Promise.all([
      signAccessToken({ userId, sid, deviceId }, now()),
      usersService.getMe(userId),
    ]);
    return { accessToken: token, accessTokenExpiresAt: expiresAt.toISOString(), user };
  }

  /** Một device chỉ có một family ACTIVE: đăng nhập lại cùng deviceId thu hồi family cũ (FR-AUTH-002). */
  async function startSession(userId: Types.ObjectId, deviceId: string, meta: RequestMeta): Promise<IssuedSession> {
    await revokeFamilies(await repo.activeFamilyIds({ userId, deviceId }), SessionRevokeReason.LOGOUT);
    const { refreshToken, csrfToken, familyId } = await issue(userId, deviceId, meta, { withCsrf: true });
    const body = await authBody(String(userId), String(familyId), deviceId);
    return { body, refreshToken, ...(csrfToken ? { csrfToken } : {}) };
  }

  return {
    async register(input: RegisterRequest, meta: RequestMeta): Promise<IssuedSession> {
      const passwordHash = await hashPassword(input.password);
      const user = await usersService.create({
        email: input.email,
        username: input.username,
        passwordHash,
        displayName: input.displayName,
      });
      return startSession(user._id, input.deviceId, meta);
    },

    /** Sai mật khẩu / không có user / LOCKED → cùng 401 và cùng chi phí verify (AC-003). */
    async login(input: LoginRequest, meta: RequestMeta): Promise<IssuedSession> {
      const user = await usersService.findByEmailWithHash(input.email);
      if (!user) {
        await verifyDummy(input.password);
        throw new AppError('UNAUTHENTICATED', INVALID_CREDENTIALS);
      }
      const ok = await verifyPassword(user.passwordHash, input.password);
      if (!ok || user.status !== UserStatus.ACTIVE) throw new AppError('UNAUTHENTICATED', INVALID_CREDENTIALS);
      if (needsRehash(user.passwordHash)) {
        await usersService.setPassword(String(user._id), await hashPassword(input.password), null); // AC-108
      }
      return startSession(user._id, input.deviceId, meta);
    },

    async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
      if (!refreshToken) throw sessionInvalid();
      const gen = await repo.findByTokenHash(hashToken(refreshToken));
      const at = now();
      let decision = decideRefresh(gen, at, false);

      if (gen && decision === 'ROTATE') {
        // A: trong transaction đánh dấu bản cũ đã xoay rồi tạo bản mới; tab khác xoay trước → xét như B/C.
        const rotated = await withTxn(async (session) => {
          if (!(await repo.markReplaced(gen._id, at, session))) return null;
          const token = randomToken(32);
          await repo.createGeneration(
            {
              familyId: gen.familyId,
              userId: gen.userId,
              deviceId: gen.deviceId,
              tokenHash: hashToken(token),
              parentHash: gen.tokenHash,
              expiresAt: new Date(at.getTime() + REFRESH_TOKEN_TTL_S * 1000),
              userAgent: meta.userAgent.slice(0, 512),
              ip: meta.ip.slice(0, 45),
            },
            session,
          );
          return token;
        });
        if (rotated) {
          const body = await authBody(String(gen.userId), String(gen.familyId), gen.deviceId);
          return { body, refreshToken: rotated };
        }
        const fresh = await repo.findByTokenHash(gen.tokenHash);
        decision = decideRefresh(fresh, at, await repo.hasCurrentChild(gen.familyId, gen.tokenHash));
      } else if (gen && gen.replacedAt !== null) {
        decision = decideRefresh(gen, at, await repo.hasCurrentChild(gen.familyId, gen.tokenHash));
      }

      if (gen && decision === 'GRACE_CONFLICT') {
        throw new AppError('CONFLICT', 'Phiên vừa được làm mới ở tab khác, vui lòng thử lại');
      }
      if (gen && decision === 'REUSE') {
        await revokeFamilies([gen.familyId], SessionRevokeReason.REFRESH_REUSE); // EC-AUTH-004
      }
      throw sessionInvalid();
    },

    /** Idempotent: token không hợp lệ / family đã thu hồi vẫn thành công (api_spec logoutSession). */
    async logout(refreshToken: string | undefined): Promise<void> {
      if (!refreshToken) return;
      const gen = await repo.findByTokenHash(hashToken(refreshToken));
      if (!gen || gen.revokedAt !== null) return;
      await revokeFamilies([gen.familyId], SessionRevokeReason.LOGOUT);
    },

    /** EC-AUTH-006 / EC-AUTH-008: rate limit do route áp trước khi gọi (tính cả lần đúng và sai). */
    async changePassword(auth: { userId: string; sid: string }, input: ChangePasswordRequest): Promise<void> {
      const user = await usersService.findByIdWithHash(auth.userId);
      if (!user) throw sessionInvalid();
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw new AppError('VALIDATION_ERROR', 'Mật khẩu hiện tại không đúng', [
          { field: 'currentPassword', reason: 'INVALID' },
        ], 422);
      }
      if (input.newPassword === input.currentPassword) {
        throw new AppError('VALIDATION_ERROR', 'Mật khẩu mới phải khác mật khẩu hiện tại', [
          { path: 'newPassword', message: 'Mật khẩu mới phải khác mật khẩu hiện tại' },
        ]);
      }
      await usersService.setPassword(auth.userId, await hashPassword(input.newPassword), now());
      const others = await repo.activeFamilyIds({
        userId: new Types.ObjectId(auth.userId),
        exceptFamilyId: new Types.ObjectId(auth.sid),
      });
      await revokeFamilies(others, SessionRevokeReason.PASSWORD_CHANGED);
    },

    getMe: (userId: string) => usersService.getMe(userId),

    isSessionRevoked: (sid: string) => repo.isRevoked(sid),

    /**
     * FR-AUTH-006 (job user:lock): LOCKED + thu hồi mọi family + publish ops:user-locked để server đang giữ socket
     * phát session:revoked ACCOUNT_LOCKED và ngắt socket (DG-03). Trả false nếu không có user.
     */
    async lockUser(email: string): Promise<boolean> {
      const user = await usersService.findByEmailWithHash(email.trim().toLowerCase());
      if (!user) return false;
      await usersService.setStatus(String(user._id), UserStatus.LOCKED);
      const families = await repo.activeFamilyIds({ userId: user._id });
      await repo.revokeFamilies(families, SessionRevokeReason.ACCOUNT_LOCKED, now());
      for (const familyId of families) {
        await repo.markRevoked(String(familyId), SessionRevokeReason.ACCOUNT_LOCKED);
        await calls.endCallsForSession(String(familyId));
      }
      await repo.publishUserLocked(String(user._id));
      return true;
    },

    async unlockUser(email: string): Promise<boolean> {
      const user = await usersService.findByEmailWithHash(email.trim().toLowerCase());
      if (!user) return false;
      await usersService.setStatus(String(user._id), UserStatus.ACTIVE);
      return true;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
