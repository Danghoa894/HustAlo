// client/src/stores/auth.store.ts — access token CHỈ trong RAM (kiến trúc §6.3). M0: khung tối thiểu cho route guard;
// M1 bổ sung user, expiresAt, đăng nhập/refresh.
import { create } from 'zustand';

export interface AuthState {
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  setAccessToken: (accessToken) => {
    set({ accessToken });
  },
}));
