// client/src/stores/ui.store.ts — toast (tối đa 3, mới nhất trên cùng; ui_ux_spec.md §5.2)
import { create } from 'zustand';

export type ToastTone = 'success' | 'warning' | 'error' | 'call';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
  /** Dòng phụ dưới text, ví dụ "Các thiết bị khác đã được đăng xuất." (ui_ux_spec.md §3.8). */
  description?: string;
}

/** Thời gian tự ẩn theo loại (ui_ux_spec.md §5.2). */
export const TOAST_DURATION_MS: Record<ToastTone, number> = { success: 4000, warning: 5000, error: 5000, call: 8000 };
export const TOAST_MAX = 3;

interface UiState {
  toasts: ToastItem[];
  /** Nội dung cho vùng aria-live (LiveRegions, ui_ux_spec.md §6.2). */
  live: { polite: string; assertive: string };
  announce: (text: string, kind?: 'polite' | 'assertive') => void;
  pushToast: (tone: ToastTone, text: string, description?: string) => number;
  dismissToast: (id: number) => void;
}

let seq = 0;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  live: { polite: '', assertive: '' },
  announce: (text, kind = 'polite') => {
    set((s) => ({ live: { ...s.live, [kind]: text } }));
  },
  pushToast: (tone, text, description) => {
    seq += 1;
    const id = seq;
    const item: ToastItem = description === undefined ? { id, tone, text } : { id, tone, text, description };
    set((s) => ({ toasts: [item, ...s.toasts].slice(0, TOAST_MAX) }));
    return id;
  },
  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
