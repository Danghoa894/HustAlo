// client/src/routes/guards/RedirectIfAuthed.tsx — đã đăng nhập → tới `next` hợp lệ hoặc /chats (ui_ux_spec.md §2)
import type { ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { DEFAULT_AUTHED_PATH, safeNext } from './safe-next';

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const [params] = useSearchParams();
  if (token) return <Navigate to={safeNext(params.get('next')) ?? DEFAULT_AUTHED_PATH} replace />;
  return <>{children}</>;
}
