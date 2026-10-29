// server/src/infra/db/transaction.ts — transaction Mongo với giới hạn retry (EC-INFRA-003: ≤ MONGO_TXN_MAX_RETRIES lần
// rồi SERVICE_UNAVAILABLE). Tự quản lý start/commit/abort thay vì session.withTransaction(): hàm đó tự retry lỗi tạm thời
// tới 120 s nên không giữ được giới hạn số lần (đo bằng TC-INFRA-003).
import mongoose, { type ClientSession } from 'mongoose';
import { MONGO_TXN_MAX_RETRIES } from '@hustalo/shared';
import { AppError } from '../../http/errors/app-error';

/** Chờ ngẫu nhiên tăng dần giữa các lần thử để transaction đang giữ khóa kịp commit (giảm WriteConflict lặp). */
const backoff = (attempt: number) =>
  new Promise((resolve) => setTimeout(resolve, (20 + Math.floor(Math.random() * 40)) * attempt));

const hasLabel = (err: unknown, label: string) => err instanceof mongoose.mongo.MongoError && err.hasErrorLabel(label);

async function commit(session: ClientSession): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await session.commitTransaction();
      return;
    } catch (err) {
      // Commit không rõ kết quả: commit lại là an toàn (idempotent theo driver).
      if (hasLabel(err, 'UnknownTransactionCommitResult') && attempt < MONGO_TXN_MAX_RETRIES) continue;
      throw err;
    }
  }
}

export async function withTxn<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      const result = await fn(session);
      await commit(session);
      return result;
    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction().catch(() => undefined);
      const transient = hasLabel(err, 'TransientTransactionError') || hasLabel(err, 'UnknownTransactionCommitResult');
      if (transient && attempt < MONGO_TXN_MAX_RETRIES) {
        await backoff(attempt);
        continue;
      }
      if (transient) throw new AppError('SERVICE_UNAVAILABLE', 'Máy chủ đang bận, vui lòng thử lại');
      throw err;
    } finally {
      await session.endSession();
    }
  }
}
