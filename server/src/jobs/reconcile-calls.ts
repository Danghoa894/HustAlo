// server/src/jobs/reconcile-calls.ts — chạy lúc boot (kiến trúc §8.5 bước 1): callHistory còn active nhưng call:active
// đã mất và quá CALL_RING_TIMEOUT_MS + CALL_CONNECT_TIMEOUT_MS → chốt T29 (ENDED/FAILED, endReason SERVER_RESTART).
import type { Logger } from 'pino';
import type { CallsService } from '../modules/calls/calls.service';

export async function reconcileCalls(calls: Pick<CallsService, 'reconcile'>, logger: Logger): Promise<number> {
  try {
    const n = await calls.reconcile();
    if (n > 0) logger.info({ count: n }, 'đã chốt cuộc gọi mồ côi sau restart');
    return n;
  } catch (err) {
    // Không chặn boot: Mongo/Redis lỗi lúc này thì lần restart sau (hoặc call:state của client, T29) sẽ chốt.
    logger.warn({ err: (err as Error).message }, 'reconcile cuộc gọi thất bại');
    return 0;
  }
}
