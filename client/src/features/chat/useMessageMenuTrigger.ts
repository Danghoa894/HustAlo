// client/src/features/chat/useMessageMenuTrigger.ts — mở MessageActions không cần hover (ui_ux_spec.md §3.3 "Menu tin
// nhắn", §7 "Nhấn giữ bubble", EC-MSG-018):
// - chuột phải (`contextmenu`) → preventDefault + mở;
// - cảm ứng: giữ LONG_PRESS_MS, hủy khi thả sớm hoặc di chuyển > LONG_PRESS_SLOP_PX (đang cuộn);
// - Android phát `contextmenu` khi giữ → chỉ mở một lần mỗi lần chạm;
// - bàn phím: Shift+F10 / ContextMenu khi chính bubble đang focus.
// `enabled = false` (tin không có mục nào) → không chặn hành vi mặc định nào.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';

/** ui_ux_spec.md §7 "Nhấn giữ bubble". */
export const LONG_PRESS_MS = 500;
/** ui_ux_spec.md §3.3: di chuyển quá ngưỡng này trong lúc giữ = đang cuộn → hủy. */
export const LONG_PRESS_SLOP_PX = 10;

export interface MessageMenuTriggerHandlers {
  onContextMenu: (e: MouseEvent<HTMLElement>) => void;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export function useMessageMenuTrigger({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }): {
  pressing: boolean;
  handlers: MessageMenuTriggerHandlers;
} {
  const [pressing, setPressing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** Đã mở menu trong lần chạm hiện tại (timer hoặc contextmenu) → không mở lần hai. Reset ở pointerdown kế tiếp. */
  const opened = useRef(false);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
    setPressing(false);
  }, []);

  useEffect(() => clear, [clear]);

  const openOnce = useCallback(() => {
    if (opened.current) return;
    opened.current = true;
    openRef.current();
  }, []);

  const handlers: MessageMenuTriggerHandlers = {
    onContextMenu: (e) => {
      if (!enabled) return;
      e.preventDefault();
      if (timer.current) clear(); // Android: contextmenu đến trước timer → dùng nó, bỏ timer
      openOnce();
    },
    onPointerDown: (e) => {
      opened.current = false;
      if (!enabled || e.pointerType !== 'touch') return;
      clear();
      start.current = { x: e.clientX, y: e.clientY };
      setPressing(true);
      timer.current = setTimeout(() => {
        timer.current = null;
        openOnce();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      const s = start.current;
      if (!s || !timer.current) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onKeyDown: (e) => {
      if (!enabled || e.target !== e.currentTarget) return; // phím trong nút/menu con không mở lại
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        e.preventDefault();
        opened.current = false;
        openOnce();
      }
    },
  };

  return { pressing, handlers };
}
