// server/src/test/fake-clock.ts — điều khiển thời gian trong test (vi.useFakeTimers + Date.now), không sleep thật
import { vi } from 'vitest';

export interface FakeClock {
  now(): number;
  advance(ms: number): Promise<void>;
  set(date: Date | number): void;
  restore(): void;
}

export function useFakeClock(start: Date | number = new Date('2026-10-27T09:00:00.000Z')): FakeClock {
  vi.useFakeTimers({ now: start, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  return {
    now: () => Date.now(),
    advance: async (ms) => {
      await vi.advanceTimersByTimeAsync(ms);
    },
    set: (date) => {
      vi.setSystemTime(date);
    },
    restore: () => {
      vi.useRealTimers();
    },
  };
}
