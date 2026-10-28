// client/src/features/auth/auth.api.ts — REST /auth/* và hồ sơ /users/me (api_spec.yaml; query key ['me'] ui_ux_spec.md §3)
import type {
  AuthResponse,
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  UpdateMeRequest,
  UserMe,
} from '@hustalo/shared';
import { http } from '../../lib/api/http';

export const ME_QUERY_KEY = ['me'] as const;

export const authApi = {
  login: (body: LoginRequest) => http<AuthResponse>('/auth/login', { method: 'POST', body, auth: false }),
  register: (body: RegisterRequest) => http<AuthResponse>('/auth/register', { method: 'POST', body, auth: false }),
  logout: () => http<undefined>('/auth/logout', { method: 'POST', auth: false, csrf: true }),
  me: () => http<UserMe>('/auth/me'),
  changePassword: (body: ChangePasswordRequest) => http<undefined>('/auth/change-password', { method: 'POST', body }),
  updateMe: (body: UpdateMeRequest) => http<UserMe>('/users/me', { method: 'PATCH', body }),
};
