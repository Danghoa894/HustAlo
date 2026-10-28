// client/src/stores/auth.store.ts — access token CHỈ trong RAM (kiến trúc §6.3), user, expiresAt.
// `bootstrapped`: đã thử /auth/refresh lúc khởi động (RequireAuth, ui_ux_spec.md §2).
// `sessionEnded`: lý do hiển thị SessionModal (ui_ux_spec.md §3.9).
import type { AuthResponse, SessionRevokeReason, UserMe } from '@hustalo/shared';
import { create } from 'zustand';

export type SessionEndReason = Exclude<SessionRevokeReason, 'LOGOUT'> | 'EXPIRED';

export interface AuthState {
  accessToken: string | null;
  /** Epoch ms của accessTokenExpiresAt. */
  expiresAt: number | null;
  user: UserMe | null;
  bootstrapped: boolean;
  sessionEnded: SessionEndReason | null;
  /** Người dùng chủ động đăng xuất (hoặc LOGOUT từ tab khác): RequireAuth về /login, không kèm ?next=. */
  signedOut: boolean;
  setSession: (session: AuthResponse) => void;
  setUser: (user: UserMe) => void;
  clearSession: () => void;
  signOut: () => void;
  /** Xóa phiên và mở SessionModal với lý do tương ứng. */
  endSession: (reason: SessionEndReason) => void;
  dismissSessionEnded: () => void;
  markBootstrapped: () => void;
}

const EMPTY = { accessToken: null, expiresAt: null, user: null } as const;

export const useAuthStore = create<AuthState>((set) => ({
  ...EMPTY,
  bootstrapped: false,
  sessionEnded: null,
  signedOut: false,
  setSession: (s) => {
    set({
      accessToken: s.accessToken,
      expiresAt: Date.parse(s.accessTokenExpiresAt),
      user: s.user,
      bootstrapped: true,
      sessionEnded: null,
      signedOut: false,
    });
  },
  setUser: (user) => {
    set({ user });
  },
  clearSession: () => {
    set({ ...EMPTY, bootstrapped: true });
  },
  signOut: () => {
    set({ ...EMPTY, bootstrapped: true, signedOut: true });
  },
  endSession: (reason) => {
    set({ ...EMPTY, bootstrapped: true, sessionEnded: reason });
  },
  dismissSessionEnded: () => {
    set({ sessionEnded: null });
  },
  markBootstrapped: () => {
    set({ bootstrapped: true });
  },
}));
