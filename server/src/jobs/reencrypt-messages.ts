// server/src/jobs/reencrypt-messages.ts — `npm run job:reencrypt -w server -- --from <keyId> [--after <messageId>] [--batch 500]`
// Xoay khóa dữ liệu (FR-SEC-003, kiến trúc §9.2.4): giải mã bằng key cũ, mã hóa lại bằng key active (IV mới, cùng AAD);
// cập nhật có điều kiện `iv` cũ để không ghi đè tin vừa được sửa đồng thời. In tiến độ {processed, lastId}, không in
// nội dung; idempotent, chạy tiếp bằng --after khi bị ngắt.
import { Types } from 'mongoose';
import { env } from '../config/env';
import { keyRing, type KeyRing } from '../infra/crypto/key-ring';
import { connectMongo, disconnectMongo } from '../infra/db/mongo';
import { logger } from '../infra/logger/logger';
import { isMainModule } from '../infra/runtime/is-main';
import { decryptContent, encryptContent } from '../modules/messages/message.crypto';
import { messagesRepository } from '../modules/messages/messages.repository';

export interface ReencryptOptions {
  from: string;
  after?: string | undefined;
  batch?: number;
  ring?: KeyRing;
  /** Gọi sau mỗi lô; trả false để dừng (test giả lập bị ngắt giữa chừng). */
  onProgress?: (p: { processed: number; lastId: string }) => boolean | undefined;
}

export interface ReencryptResult {
  processed: number;
  skipped: number;
  failed: number;
  lastId: string | null;
  remaining: number;
}

export async function runReencrypt(opts: ReencryptOptions): Promise<ReencryptResult> {
  const ring = opts.ring ?? keyRing;
  const batch = opts.batch ?? 500;
  if (ring.active().keyId === opts.from) throw new Error('--from trùng key đang active, không có gì để xoay');
  let after = opts.after ? new Types.ObjectId(opts.after) : null;
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (;;) {
    const docs = await messagesRepository.batchByKeyId(opts.from, after, batch);
    if (docs.length === 0) break;
    for (const d of docs) {
      const enc = d.contentEnc;
      if (!enc) continue;
      const plain = decryptContent(d.conversationId, d._id, enc, ring);
      if (plain === null) {
        failed += 1; // không giải mã được: giữ nguyên để điều tra, không ghi đè
        continue;
      }
      const ok = await messagesRepository.replaceContentEnc(
        d._id,
        opts.from,
        enc.iv,
        encryptContent(d.conversationId, d._id, plain, ring),
      );
      if (ok) processed += 1;
      else skipped += 1; // đã được sửa/xoay đồng thời
    }
    after = docs[docs.length - 1]?._id ?? after;
    if (opts.onProgress?.({ processed, lastId: String(after) }) === false) break;
  }

  return {
    processed,
    skipped,
    failed,
    lastId: after ? String(after) : null,
    remaining: await messagesRepository.countByKeyId(opts.from),
  };
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const from = argValue(args, '--from');
  if (!from) {
    logger.error('Cách dùng: npm run job:reencrypt -w server -- --from <keyId> [--after <messageId>] [--batch 500]');
    process.exit(2);
  }
  await connectMongo(env.MONGODB_URI);
  const result = await runReencrypt({
    from,
    after: argValue(args, '--after'),
    batch: Number(argValue(args, '--batch') ?? 500),
    onProgress: (p) => {
      logger.info(p, 'reencrypt tiến độ');
      return true;
    },
  });
  await disconnectMongo();
  logger.info(result, result.remaining === 0 ? 'reencrypt xong — có thể gỡ key cũ' : 'reencrypt còn tin chưa xoay');
}
