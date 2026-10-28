// client/src/routes/guards/RequireAuth.tsx — có access token → render. Chưa có: lần đầu khởi động gọi /auth/refresh
// một lần và hiện Spinner toàn trang "Đang tải…"; refresh lỗi → /login?next=<đường dẫn hiện tại> (ui_ux_spec.md §2).
// Đăng xuất chủ động (auth.store.signOut) → /login không kèm next (ui_ux_spec.md §3.8, §3.9).
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '../../components/ui/Spinner';
import { vi } from '../../i18n/vi';
import { bootstrapSession } from '../../lib/api/refresh';
import { useAuthStore } from '../../stores/auth.store';

export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const signedOut = useAuthStore((s) => s.signedOut);
  const location = useLocation();

  useEffect(() => {
    if (!token && !bootstrapped) void bootstrapSession();
  }, [token, bootstrapped]);

  if (token) return <>{children}</>;
  if (!bootstrapped) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label={vi.app.loading} size={32} />
      </div>
    );
  }
  if (signedOut) return <Navigate to="/login" replace />;
  const next = `${location.pathname}${location.search}`;
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}
