// server/src/realtime/handlers/session.handler.ts — vòng đời phiên trên socket:
// - SessionNotifier: phát session:revoked vào room session:{sid} rồi ngắt socket của session đó (kiến trúc §7(a)).
// - Subscribe kênh Redis ops:user-locked (job user:lock chạy ở process khác, DG-03): phát session:revoked
//   ACCOUNT_LOCKED vào room user:{userId} rồi disconnectSockets(true).
// D-08 (đẩy call:incoming đang chờ khi callee kết nối) bổ sung ở M5.
import { EVENTS, SessionRevokeReason } from '@hustalo/shared';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { keys } from '../../infra/redis/keys';
import type { SessionNotifier } from '../../modules/auth/auth.service';
import type { Emitter } from '../emitter';
import { sessionRoom, userRoom } from '../rooms';

export function createSessionNotifier(emitter: Emitter): SessionNotifier {
  return {
    sessionRevoked(sid, reason) {
      emitter.toSession(sid, EVENTS.SESSION_REVOKED, { reason });
      // Engine.IO đẩy hết gói đang chờ trước khi đóng transport → client nhận event rồi mới bị ngắt.
      emitter.disconnect(sessionRoom(sid));
    },
  };
}

export interface UserLockedSubscription {
  close(): Promise<void>;
}

/** `subscriber` là kết nối Redis riêng (chế độ subscribe không chạy lệnh thường được). */
export async function subscribeUserLocked(
  subscriber: Redis,
  emitter: Emitter,
  logger: Logger,
): Promise<UserLockedSubscription> {
  const channel = keys.opsUserLocked();
  subscriber.on('message', (ch: string, message: string) => {
    if (ch !== channel) return;
    try {
      const { userId } = JSON.parse(message) as { userId?: unknown };
      if (typeof userId !== 'string') return;
      emitter.toUser(userId, EVENTS.SESSION_REVOKED, { reason: SessionRevokeReason.ACCOUNT_LOCKED });
      emitter.disconnect(userRoom(userId));
      logger.info({ userId }, 'đã ngắt socket của tài khoản bị khóa');
    } catch {
      logger.warn({ channel }, 'message ops:user-locked không hợp lệ');
    }
  });
  await subscriber.subscribe(channel);
  return {
    close: async () => {
      await subscriber.unsubscribe(channel).catch(() => undefined);
    },
  };
}
