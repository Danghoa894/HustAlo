// client/src/stores/e2ee.store.ts — trạng thái E2EE của phiên (kiến trúc §4.1): device đã đăng ký khóa chưa
// (FR-E2EE-001, 409 → LIMIT), placeholder của tin SECRET không có bản rõ (ui_ux_spec.md §3.3), và `revision` tăng khi
// session / identity đổi để useSecretSession tính lại.
import { create } from 'zustand';

export type DeviceKeysState = 'IDLE' | 'READY' | 'LIMIT' | 'ERROR';
export type SecretPlaceholder = 'NOT_FOR_DEVICE' | 'REVOKED_DEVICE' | 'DECRYPT_FAILED';

interface E2eeState {
  device: DeviceKeysState;
  placeholders: Record<string, SecretPlaceholder>;
  revision: number;
  setDevice: (d: DeviceKeysState) => void;
  setPlaceholder: (messageId: string, p: SecretPlaceholder | null) => void;
  bump: () => void;
  reset: () => void;
}

export const useE2eeStore = create<E2eeState>((set) => ({
  device: 'IDLE',
  placeholders: {},
  revision: 0,
  setDevice: (device) => {
    set({ device });
  },
  setPlaceholder: (messageId, p) => {
    set((s) => {
      if ((s.placeholders[messageId] ?? null) === p) return s;
      const next = Object.fromEntries(Object.entries(s.placeholders).filter(([id]) => id !== messageId));
      return { placeholders: p ? { ...next, [messageId]: p } : next };
    });
  },
  bump: () => {
    set((s) => ({ revision: s.revision + 1 }));
  },
  reset: () => {
    set({ device: 'IDLE', placeholders: {}, revision: 0 });
  },
}));
