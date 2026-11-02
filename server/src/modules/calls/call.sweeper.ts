// server/src/modules/calls/call.sweeper.ts — xử lý deadline cuộc gọi mỗi CALL_DEADLINE_SWEEP_INTERVAL_MS (D-05, §8.3):
// call-deadlines-claim.lua lấy tối đa 50 member đến hạn và ZREM trong cùng script → mỗi deadline chỉ một instance xử lý.
import type { Logger } from 'pino';

const SWEEP_BATCH = 50;

export interface CallSweeperDeps {
  claimDue(nowMs: number, limit: number): Promise<string[]>;
  onDeadline(member: string): Promise<void>;
  intervalMs: number;
  logger: Logger;
}

export function createCallSweeper(deps: CallSweeperDeps) {
  let timer: NodeJS.Timeout | null = null;

  async function sweep(): Promise<void> {
    const due = await deps.claimDue(Date.now(), SWEEP_BATCH);
    for (const member of due) {
      await deps
        .onDeadline(member)
        .catch((err: unknown) => deps.logger.error({ err, member }, 'xử lý deadline cuộc gọi lỗi'));
    }
  }

  return {
    sweep,
    start: () => {
      if (timer) return;
      timer = setInterval(() => {
        void sweep().catch((err: unknown) => deps.logger.warn({ err: (err as Error).message }, 'sweeper cuộc gọi lỗi'));
      }, deps.intervalMs);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
