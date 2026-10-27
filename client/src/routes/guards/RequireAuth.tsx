// client/src/routes/guards/RequireAuth.tsx — có access token → render; không có → /login?next=<đường dẫn hiện tại>.
// M1 bổ sung: gọi /auth/refresh một lần khi khởi động và hiển thị Spinner "Đang tải…" (ui_ux_spec.md §2).
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';

export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const location = useLocation();
  if (!token) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}
