// client/src/features/calls/call-stats-hook.test.ts — window.__hustaloCallStats chỉ có ở bản dev (development_guide.md §6.6).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCallStatsHook } from './call-stats-hook';

const STATS = [{ id: 'cp', type: 'candidate-pair', timestamp: 1 } as RTCStats];

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.__hustaloCallStats;
});

describe('installCallStatsHook (development_guide.md §6.6)', () => {
  it('bản production (import.meta.env.DEV = false) → không gắn window.__hustaloCallStats', () => {
    vi.stubEnv('DEV', false);
    const uninstall = installCallStatsHook(() => Promise.resolve(STATS));
    expect('__hustaloCallStats' in window).toBe(false);
    uninstall();
  });

  it('bản dev → window.__hustaloCallStats() trả về stats của cuộc gọi hiện tại; gỡ khi controller dừng', async () => {
    vi.stubEnv('DEV', true);
    const uninstall = installCallStatsHook(() => Promise.resolve(STATS));
    await expect(window.__hustaloCallStats?.()).resolves.toEqual(STATS);
    uninstall();
    expect('__hustaloCallStats' in window).toBe(false);
  });
});
