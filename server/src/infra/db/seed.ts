// server/src/infra/db/seed.ts — `npm run db:seed`: alice, bob, carol (database_schema.md §6.5), idempotent theo email.
// M1: chỉ tạo user. DIRECT alice–bob + 3 tin mẫu và GROUP "Nhóm HUSTALO" bổ sung khi có model (M2/M3).
import { normalizeForSearch } from '@hustalo/shared';
import { env } from '../../config/env';
import { UserModel } from '../../modules/users/user.model';
import { hashPassword } from '../crypto/password';
import { logger } from '../logger/logger';
import { isMainModule } from '../runtime/is-main';
import { connectMongo, disconnectMongo } from './mongo';
import { ensureIndexes } from './indexes';

export const SEED_USERS = [
  { email: 'alice@hustalo.local', username: 'alice', displayName: 'Alice Nguyễn' },
  { email: 'bob@hustalo.local', username: 'bob', displayName: 'Bob Trần' },
  { email: 'carol@hustalo.local', username: 'carol', displayName: 'Carol Lê' },
] as const;

export async function seed(password: string): Promise<{ created: number }> {
  const passwordHash = await hashPassword(password);
  let created = 0;
  for (const u of SEED_USERS) {
    const res = await UserModel.updateOne(
      { email: u.email },
      { $setOnInsert: { ...u, passwordHash, displayNameNormalized: normalizeForSearch(u.displayName) } },
      { upsert: true },
    ).exec();
    created += res.upsertedCount;
  }
  return { created };
}

if (isMainModule(import.meta.url)) {
  if (env.NODE_ENV === 'production') {
    logger.error('db:seed từ chối chạy khi NODE_ENV=production');
    process.exit(1);
  }
  if (!env.SEED_PASSWORD) {
    logger.error('Thiếu SEED_PASSWORD trong server/.env');
    process.exit(1);
  }
  await connectMongo(env.MONGODB_URI);
  await ensureIndexes();
  const { created } = await seed(env.SEED_PASSWORD);
  logger.info({ created }, 'seed xong');
  await disconnectMongo();
}
