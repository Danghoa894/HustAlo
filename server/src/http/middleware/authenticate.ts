// server/src/http/middleware/authenticate.ts — Bearer JWT → res.locals.auth {userId, sid, deviceId}; kiểm tra
// session bị thu hồi (AUTHZ-1, kiến trúc §6.2; FR-SEC-008)
import type { RequestHandler, Response } from 'express';
import { verifyAccessToken } from '../../infra/jwt/jwt';
import { AppError } from '../errors/app-error';

export interface RequestAuth {
  userId: string;
  sid: string;
  deviceId: string;
}

export interface RevocationChecker {
  isSessionRevoked(sid: string): Promise<boolean>;
}

export function getAuth(res: Response): RequestAuth {
  const auth = (res.locals as { auth?: RequestAuth }).auth;
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Chưa đăng nhập');
  return auth;
}

export function authenticate(checker: RevocationChecker): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      next(new AppError('UNAUTHENTICATED', 'Chưa đăng nhập'));
      return;
    }
    verifyAccessToken(token)
      .then(async (claims) => {
        // Thu hồi (logout, đổi mật khẩu, reuse, khóa tài khoản) → 401 ngay cả khi token còn hạn (AC-010).
        if (await checker.isSessionRevoked(claims.sid)) throw new AppError('UNAUTHENTICATED', 'Phiên đã bị thu hồi');
        const auth: RequestAuth = { userId: claims.userId, sid: claims.sid, deviceId: claims.deviceId };
        (res.locals as { auth?: RequestAuth }).auth = auth;
        req.log.setBindings({ userId: auth.userId, sid: auth.sid, deviceId: auth.deviceId });
        next();
      })
      .catch(next);
  };
}
