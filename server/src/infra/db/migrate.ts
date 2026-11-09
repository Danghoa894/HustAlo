// server/src/infra/db/migrate.ts — entry `npm run db:migrate` (dev, tsx) và `node dist/infra/db/migrate.js`
// (production, development_guide.md §9.6 bước 5a). database_schema.md §6.4:
// - đọc `_migrations` ({ _id: id, appliedAt }), chạy migration chưa áp dụng theo thứ tự id, ghi `_migrations` sau khi
//   `up` hoàn tất; không có migration down;
// - một migration throw → dừng ngay, không ghi migration đó (migration trước đã ghi thì giữ), exit khác 0;
// - không log dữ liệu document (FR-SEC-007): chỉ log id và tên lỗi.
import mongoose from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../logger/logger';
import { isMainModule } from '../runtime/is-main';
import { MIGRATIONS, type Migration } from './migrations';
import { connectMongo, disconnectMongo } from './mongo';

export type { Migration };

export const MIGRATIONS_COLLECTION = '_migrations';

const MIGRATION_ID = /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface MigrationRecord {
  _id: string;
  appliedAt: Date;
}

function validate(migrations: readonly Migration[]): Migration[] {
  const seen = new Set<string>();
  for (const m of migrations) {
    if (!MIGRATION_ID.test(m.id)) throw new Error(`Migration id "${m.id}" phải có dạng NNN-<tên>`);
    if (seen.has(m.id)) throw new Error(`Migration id "${m.id}" bị trùng`);
    seen.add(m.id);
  }
  return [...migrations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Chạy các migration chưa áp dụng; ném lỗi ở migration đầu tiên thất bại. Cần kết nối mongoose sẵn. */
export async function runMigrations(migrations: readonly Migration[]): Promise<{ applied: string[] }> {
  const ordered = validate(migrations);
  const records = mongoose.connection.collection<MigrationRecord>(MIGRATIONS_COLLECTION);
  const done = new Set((await records.find({}, { projection: { _id: 1 } }).toArray()).map((r) => r._id));
  const applied: string[] = [];
  for (const m of ordered) {
    if (done.has(m.id)) continue;
    try {
      await m.up();
    } catch (err) {
      throw new Error(`Migration ${m.id} thất bại: ${err instanceof Error ? err.name : 'Error'}`, { cause: err });
    }
    await records.insertOne({ _id: m.id, appliedAt: new Date() });
    applied.push(m.id);
  }
  return { applied };
}

/** Bọc runMigrations cho dòng lệnh: in "N migration", trả exit code (0 thành công, 1 thất bại). */
export async function migrateCli(
  migrations: readonly Migration[],
  report: (message: string) => void = (message) => {
    logger.info(message);
  },
): Promise<number> {
  try {
    const { applied } = await runMigrations(migrations);
    report(`${applied.length} migration`);
    return 0;
  } catch (err) {
    // Chỉ message do runner dựng (id + tên lỗi), không log cause để tránh lộ dữ liệu document.
    logger.error({ reason: err instanceof Error ? err.message : 'unknown' }, 'db:migrate thất bại');
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  await connectMongo(env.MONGODB_URI);
  const code = await migrateCli(MIGRATIONS);
  await disconnectMongo();
  process.exitCode = code;
}
