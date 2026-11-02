// client/src/features/calls/autoplay.ts — phần tử media chờ được phát khi trình duyệt chặn autoplay (ui_ux_spec.md §4.4):
// play() reject NotAllowedError → đăng ký + bật cờ S.call.autoplayBlocked; AutoplayUnlockButton gọi lại play() cho tất cả.
import { useCallStore } from '../../stores/call.store';

const waiting = new Set<HTMLMediaElement>();

/** Phát phần tử; bị chặn autoplay → chờ người dùng chạm (lỗi khác bỏ qua, ví dụ thiếu file âm thanh). */
export function playOrQueue(el: HTMLMediaElement): void {
  // play() trả Promise ở trình duyệt hiện đại; trình duyệt cũ (và jsdom) trả undefined.
  const p = el.play() as Promise<void> | undefined;
  p?.catch((err: unknown) => {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      waiting.add(el);
      useCallStore.getState().patch({ autoplayBlocked: true });
    }
  });
}

export function forget(el: HTMLMediaElement): void {
  if (!waiting.delete(el)) return;
  if (waiting.size === 0) useCallStore.getState().patch({ autoplayBlocked: false });
}

/** Gọi trong handler của cử chỉ người dùng (chạm nút). */
export async function unlockAll(): Promise<void> {
  const els = [...waiting];
  const results = await Promise.allSettled(els.map((el) => el.play()));
  results.forEach((r, i) => {
    const el = els[i];
    if (r.status === 'fulfilled' && el) waiting.delete(el);
  });
  useCallStore.getState().patch({ autoplayBlocked: waiting.size > 0 });
}
