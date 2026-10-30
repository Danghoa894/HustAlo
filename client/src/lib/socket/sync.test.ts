import { SOCKET_PING_INTERVAL_MS, SOCKET_PING_TIMEOUT_MS } from '@hustalo/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_DEBOUNCE_MS, createSyncScheduler, watchResume } from './sync';

describe('lib/socket/sync (kiến trúc §7(c))', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-NET-002 reconnect liên tục: debounce 500 ms → chỉ chạy một lần sync', async () => {
    const run = vi.fn(() => Promise.resolve());
    const sync = createSyncScheduler(run);
    for (let i = 0; i < 5; i += 1) {
      sync.trigger();
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('TC-NET-007 reconnect khi sync cũ chưa xong: kết quả của generation cũ bị bỏ', async () => {
    const applied: number[] = [];
    let call = 0;
    const sync = createSyncScheduler(async (isCurrent) => {
      call += 1;
      const mine = call;
      await new Promise((r) => setTimeout(r, mine === 1 ? 2000 : 10)); // lần 1 chậm
      if (isCurrent()) applied.push(mine);
    });
    sync.trigger();
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS + 100); // lần 1 đang chạy
    sync.trigger();
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS + 3000);
    expect(applied).toEqual([2]);
  });

  it('TC-NET-009 máy ngủ rồi thức (khoảng trống > ping interval + timeout) → gọi onWake', async () => {
    let now = 0;
    const onWake = vi.fn();
    const onVisible = vi.fn();
    const stop = watchResume({ onWake, onVisible, now: () => now, tickMs: 5000 });
    now += 5000;
    await vi.advanceTimersByTimeAsync(5000);
    expect(onWake).not.toHaveBeenCalled();
    now += SOCKET_PING_INTERVAL_MS + SOCKET_PING_TIMEOUT_MS + 10_000; // máy ngủ: timer không chạy
    await vi.advanceTimersByTimeAsync(5000);
    expect(onWake).toHaveBeenCalledTimes(1);
    stop();
  });

  it('TC-NET-008 tab nền: visibilitychange → visible và sự kiện online → onVisible (xả outbox)', () => {
    const onVisible = vi.fn();
    const stop = watchResume({ onWake: vi.fn(), onVisible });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(onVisible).toHaveBeenCalledTimes(2);
    stop();
  });
});
