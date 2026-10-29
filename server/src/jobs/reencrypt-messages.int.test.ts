import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createKeyRing } from '../infra/crypto/key-ring';
import { connectMongo, disconnectMongo } from '../infra/db/mongo';
import { ensureIndexes } from '../infra/db/indexes';
import { decryptContent, encryptContent } from '../modules/messages/message.crypto';
import { MessageModel } from '../modules/messages/message.model';
import { TEST_DATA_KEY } from '../test/test-env';
import { runReencrypt } from './reencrypt-messages';

const K2 = Buffer.alloc(32, 9).toString('base64');
const ring = createKeyRing({ ktest1: TEST_DATA_KEY, ktest2: K2 }, 'ktest2'); // k2 active, còn giữ k1 để đọc
const conv = new Types.ObjectId();

beforeAll(async () => {
  await connectMongo(process.env.MONGODB_URI ?? '');
  await ensureIndexes();
});
afterAll(async () => {
  await disconnectMongo();
});
beforeEach(async () => {
  await MessageModel.deleteMany({});
});

/** `n` tin mã hóa bằng ktest1 (key active của env test), nội dung "tin {i}". */
async function seed(n: number) {
  const docs = Array.from({ length: n }, (_, i) => {
    const _id = new Types.ObjectId();
    return {
      _id,
      conversationId: conv,
      senderId: new Types.ObjectId(),
      clientMessageId: randomUUID(),
      type: 'TEXT',
      createdAt: new Date(),
      contentEnc: encryptContent(conv, _id, `tin ${String(i)}`),
    };
  });
  await MessageModel.insertMany(docs);
  return docs;
}

describe('job:reencrypt (FR-SEC-003, kiến trúc §9.2.4)', () => {
  it('TC-AC-101 TC-DB-020 ngắt giữa chừng rồi chạy lại --after; tin sửa đồng thời giữ nội dung mới; 0 tin còn k1', async () => {
    const docs = await seed(1000);
    const first = await runReencrypt({ from: 'ktest1', batch: 300, ring, onProgress: () => false }); // dừng sau lô đầu
    expect(first.processed).toBe(300);
    expect(first.remaining).toBe(700);

    // Sửa đồng thời một tin chưa xoay: server (đã chuyển active sang k2) ghi IV mới → job phải bỏ qua, không ghi đè.
    const edited = docs[500];
    if (!edited) throw new Error('thiếu dữ liệu');
    await MessageModel.updateOne(
      { _id: edited._id },
      { $set: { contentEnc: encryptContent(conv, edited._id, 'đã sửa', ring), editedAt: new Date() } },
    );

    const rest = await runReencrypt({ from: 'ktest1', after: first.lastId ?? undefined, batch: 300, ring });
    expect(rest.remaining).toBe(0);
    expect(rest.failed).toBe(0);
    expect(await MessageModel.countDocuments({ 'contentEnc.keyId': 'ktest1' })).toBe(0);

    const all = await MessageModel.find({ conversationId: conv }).lean<
      { _id: Types.ObjectId; contentEnc: Parameters<typeof decryptContent>[2] }[]
    >();
    const texts = new Map(all.map((m) => [String(m._id), decryptContent(conv, m._id, m.contentEnc, ring)]));
    expect(texts.get(String(edited._id))).toBe('đã sửa');
    expect(texts.get(String(docs[0]?._id))).toBe('tin 0');
    expect(texts.get(String(docs[999]?._id))).toBe('tin 999');
    expect([...texts.values()].every((t) => t !== null)).toBe(true);
  });

  it('--from trùng key active → báo lỗi, không làm gì', async () => {
    await expect(runReencrypt({ from: 'ktest2', ring })).rejects.toThrow();
  });
});
