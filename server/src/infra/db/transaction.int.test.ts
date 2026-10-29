import mongoose from 'mongoose';
import { MONGO_TXN_MAX_RETRIES } from '@hustalo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from './mongo';
import { withTxn } from './transaction';

beforeAll(async () => {
  await connectMongo(process.env.MONGODB_URI ?? '');
});
afterAll(async () => {
  await disconnectMongo();
});

function transient(): Error {
  const err = new mongoose.mongo.MongoServerError({ message: 'giả lập WriteConflict', code: 112 });
  err.addErrorLabel('TransientTransactionError');
  return err;
}

describe('withTxn (EC-INFRA-003)', () => {
  it('TC-INFRA-003 lỗi tạm thời liên tục → retry tối đa MONGO_TXN_MAX_RETRIES lần rồi SERVICE_UNAVAILABLE', async () => {
    let calls = 0;
    const p = withTxn(() => {
      calls += 1;
      return Promise.reject(transient());
    });
    await expect(p).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(calls).toBeGreaterThanOrEqual(MONGO_TXN_MAX_RETRIES);
  });

  it('TC-INFRA-003 lỗi tạm thời một lần rồi thành công → trả kết quả', async () => {
    let calls = 0;
    const result = await withTxn(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(transient()) : Promise.resolve('ok');
    });
    expect(result).toBe('ok');
  });
});
