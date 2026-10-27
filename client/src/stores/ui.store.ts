// client/src/stores/ui.store.ts — toast (tối đa 3, mới nhất trên cùng; ui_ux_spec.md §5.2)
import { create } from 'zustand';

export type ToastTone = 'success' | 'warning' | 'error' | 'call';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
}

/** Thời gian tự ẩn theo loại (ui_ux_spec.md §5.2). */
export const TOAST_DURATION_MS: Record<ToastTone, number> = { success: 4000, warning: 5000, error: 5000, call: 8000 };
export const TOAST_MAX = 3;

interface UiState {
  toasts: ToastItem[];
  pushToast: (tone: ToastTone, text: string) => number;
  dismissToast: (id: number) => void;
}

let seq = 0;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  pushToast: (tone, text) => {
    seq += 1;
    const id = seq;
    set((s) => ({ toasts: [{ id, tone, text }, ...s.toasts].slice(0, TOAST_MAX) }));
    return id;
  },
  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
