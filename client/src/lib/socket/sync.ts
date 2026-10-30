// client/src/lib/socket/sync.ts — đồng bộ sau reconnect (kiến trúc §7(c); FR-CHAT-010):
// - createSyncScheduler: debounce SYNC_DEBOUNCE_MS (flapping, EC-NET-002) + generation counter — kết quả của lần sync
//   cũ hơn bị bỏ (EC-NET-007).
// - watchResume: máy ngủ/thức (khoảng trống giữa hai tick > ping interval + timeout → onWake, EC-NET-009);
//   visibilitychange → visible và sự kiện online → onVisible (xả outbox, EC-NET-008).
import { SOCKET_PING_INTERVAL_MS, SOCKET_PING_TIMEOUT_MS } from '@hustalo/shared';

export const SYNC_DEBOUNCE_MS = 500;

export function createSyncScheduler(run: (isCurrent: () => boolean) => Promise<void>, debounceMs = SYNC_DEBOUNCE_MS) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    trigger(): void {
      clearTimeout(timer);
      timer = setTimeout(() => {
        generation += 1;
        const mine = generation;
        void run(() => mine === generation).catch(() => undefined);
      }, debounceMs);
    },
    dispose(): void {
      clearTimeout(timer);
      generation += 1;
    },
  };
}

export interface ResumeOptions {
  onWake: () => void;
  onVisible: () => void;
  now?: () => number;
  tickMs?: number;
}

export function watchResume({ onWake, onVisible, now = Date.now, tickMs = 5000 }: ResumeOptions): () => void {
  const gap = SOCKET_PING_INTERVAL_MS + SOCKET_PING_TIMEOUT_MS;
  let last = now();
  const timer = setInterval(() => {
    const t = now();
    if (t - last > gap) onWake();
    last = t;
  }, tickMs);
  const onVisibility = () => {
    if (document.visibilityState === 'visible') onVisible();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onVisible);
  };
}
