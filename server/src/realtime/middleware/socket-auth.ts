// server/src/realtime/middleware/socket-auth.ts — xác thực handshake, join room, hẹn giờ session:expired
// (AUTHZ-1, kiến trúc §6.4, §7(a), D-14, D-18; FR-AUTH-007)
import {
  EVENTS,
  SESSION_EXPIRED_DISCONNECT_DELAY_MS,
  SocketHandshakeAuthSchema,
} from '@hustalo/shared';
import type { Logger } from 'pino';
import type { Socket } from 'socket.io';
import { AppError } from '../../http/errors/app-error';
import { verifyAccessToken } from '../../infra/jwt/jwt';
import { withMeta } from '../emitter';
import { deviceRoom, sessionRoom, tabRoom, userRoom } from '../rooms';

export interface SocketRevocationChecker {
  isSessionRevoked(sid: string): Promise<boolean>;
}

/** Lỗi connect_error: message là mã lỗi để client phân biệt TOKEN_EXPIRED / UNAUTHENTICATED (kiến trúc §7(a)). */
const reject = (code: 'TOKEN_EXPIRED' | 'UNAUTHENTICATED') => new Error(code);

export function socketAuth(deps: { checker: SocketRevocationChecker; logger: Logger }) {
  return (socket: Socket, next: (err?: Error) => void): void => {
    const parsed = SocketHandshakeAuthSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) {
      next(reject('UNAUTHENTICATED'));
      return;
    }
    const { token, deviceId, tabId } = parsed.data;

    verifyAccessToken(token)
      .then(async (claims) => {
        if (claims.deviceId !== deviceId) throw new AppError('UNAUTHENTICATED', 'deviceId không khớp did');
        if (await deps.checker.isSessionRevoked(claims.sid)) throw new AppError('UNAUTHENTICATED', 'sid bị thu hồi');

        (socket.data as { auth?: unknown }).auth = { userId: claims.userId, sid: claims.sid, deviceId, tabId, exp: claims.exp };
        await socket.join([userRoom(claims.userId), deviceRoom(deviceId), tabRoom(tabId), sessionRoom(claims.sid)]);
        scheduleExpiry(socket, claims.exp);
        next();
      })
      .catch((err: unknown) => {
        const code = err instanceof AppError && err.code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED';
        deps.logger.info({ reason: code, deviceId }, 'socket handshake bị từ chối');
        next(reject(code));
      });
  };
}

/** Tới exp: phát session:expired, sau SESSION_EXPIRED_DISCONNECT_DELAY_MS ngắt nếu chưa reconnect (D-18). */
function scheduleExpiry(socket: Socket, exp: number): void {
  let disconnectTimer: NodeJS.Timeout | undefined;
  const expiryTimer = setTimeout(
    () => {
      socket.emit(EVENTS.SESSION_EXPIRED, withMeta({ reason: 'TOKEN_EXPIRED', expiredAt: new Date(exp * 1000).toISOString() }));
      disconnectTimer = setTimeout(() => {
        socket.disconnect(true);
      }, SESSION_EXPIRED_DISCONNECT_DELAY_MS);
    },
    Math.max(0, exp * 1000 - Date.now()),
  );
  socket.once('disconnect', () => {
    clearTimeout(expiryTimer);
    clearTimeout(disconnectTimer);
  });
}
