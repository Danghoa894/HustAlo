// server/src/jobs/user-lock.ts — `npm run user:lock -w server -- <email>` / `user:unlock` (FR-AUTH-006, DG-03)
// Chạy ở process riêng: thu hồi family trong Mongo + set session:revoked, rồi publish ops:user-locked để
// server đang giữ socket phát session:revoked ACCOUNT_LOCKED và ngắt socket.
import type { SessionRevokeReason } from '@hustalo/shared';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../infra/db/mongo';
import { logger } from '../infra/logger/logger';
import { connectRedis, createRedis } from '../infra/redis/redis';
import { isMainModule } from '../infra/runtime/is-main';
import { createAuthRepository } from '../modules/auth/auth.repository';
import { createAuthService } from '../modules/auth/auth.service';

/** Process job không giữ socket → notifier rỗng; việc ngắt socket đi qua kênh Redis. */
const noopNotifier = { sessionRevoked: (_sid: string, _reason: SessionRevokeReason) => undefined };

export async function runUserLock(action: 'lock' | 'unlock', email: string): Promise<boolean> {
  const redis = createRedis(env.REDIS_URL);
  await connectRedis(redis);
  try {
    const auth = createAuthService({ repo: createAuthRepository(redis), notifier: noopNotifier });
    return action === 'lock' ? await auth.lockUser(email) : await auth.unlockUser(email);
  } finally {
    await redis.close();
  }
}

if (isMainModule(import.meta.url)) {
  const [action, email] = process.argv.slice(2);
  if ((action !== 'lock' && action !== 'unlock') || !email) {
    logger.error('Cách dùng: npm run user:lock -w server -- <email>  |  npm run user:unlock -w server -- <email>');
    process.exit(2);
  }
  await connectMongo(env.MONGODB_URI);
  const found = await runUserLock(action, email);
  await disconnectMongo();
  if (!found) {
    logger.error({ action }, 'không tìm thấy người dùng');
    process.exit(1);
  }
  logger.info({ action }, action === 'lock' ? 'đã khóa tài khoản' : 'đã mở khóa tài khoản');
}
