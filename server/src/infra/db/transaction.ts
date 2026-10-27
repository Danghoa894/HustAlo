// server/src/infra/db/transaction.ts
import mongoose, { type ClientSession } from 'mongoose';
import { MONGO_TXN_MAX_RETRIES } from '@hustalo/shared';
import { AppError } from '../../http/errors/app-error';

export async function withTxn<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      await session.withTransaction(
        async () => {
          result = await fn(session);
        },
        {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
        },
      );
      return result;
    } catch (err) {
      const transient =
        err instanceof mongoose.mongo.MongoError &&
        (err.hasErrorLabel('TransientTransactionError') || err.hasErrorLabel('UnknownTransactionCommitResult'));
      attempt += 1;
      if (transient && attempt < MONGO_TXN_MAX_RETRIES) continue;
      if (transient) throw new AppError('SERVICE_UNAVAILABLE', 'Máy chủ đang bận, vui lòng thử lại');
      throw err;
    } finally {
      await session.endSession();
    }
  }
}
// session.withTransaction tự retry nội bộ; vòng ngoài giới hạn tổng số lần (EC-INFRA-003).
// Xác minh với tài liệu chính thức của MongoDB Node driver: hành vi retry của withTransaction.
