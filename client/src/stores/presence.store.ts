// client/src/stores/presence.store.ts — S.presence: trạng thái người đã subscribe (FR-PRES-001..003, ui_ux_spec.md §3.2,
// §4.1 "Presence không xác định"). `degraded` → ẩn chấm online và dòng lastSeen.
import type { PresenceEntry } from '@hustalo/shared';
import { create } from 'zustand';

interface PresenceState {
  users: Record<string, PresenceEntry>;
  degraded: boolean;
  applySnapshot: (users: PresenceEntry[], degraded: boolean) => void;
  applyUpdate: (entry: PresenceEntry) => void;
  reset: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  users: {},
  degraded: false,
  applySnapshot: (users, degraded) => {
    set((s) => ({ degraded, users: { ...s.users, ...Object.fromEntries(users.map((u) => [u.userId, u])) } }));
  },
  applyUpdate: (entry) => {
    set((s) => ({ users: { ...s.users, [entry.userId]: entry } }));
  },
  reset: () => {
    set({ users: {}, degraded: false });
  },
}));
