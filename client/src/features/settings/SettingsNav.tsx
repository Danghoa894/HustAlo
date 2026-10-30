// client/src/features/settings/SettingsNav.tsx — menu cài đặt, role="navigation" (ui_ux_spec.md §3.8).
// Hồ sơ, Quyền riêng tư (M4), Người đã chặn (M3), Bảo mật; Thiết bị (M7), Giao diện thêm ở milestone tương ứng.
// Đăng xuất: POST /auth/logout → xóa phiên → /login (FR-AUTH-004). Modal "đang trong cuộc gọi" (EC-AUTH-007) ở M5.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LogOut } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { authApi } from '../auth/auth.api';
import { formErrorMessage } from '../auth/form';

export const SETTINGS_SECTIONS = ['profile', 'privacy', 'blocked', 'security'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function SettingsNav() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);

  const finish = () => {
    useAuthStore.getState().signOut();
    queryClient.clear();
    navigate('/login', { replace: true });
  };

  const logout = useMutation({
    mutationFn: authApi.logout,
    onSuccess: finish,
    onError: (err) => {
      // 401: family đã bị thu hồi ở nơi khác → coi như đã đăng xuất.
      if (err instanceof ApiError && err.status === 401) finish();
      else pushToast('error', formErrorMessage(err));
    },
  });

  return (
    <nav aria-label={vi.settings.title} className="flex flex-col gap-1 p-4">
      <h1 className="mb-3 text-2xl font-semibold">{vi.settings.title}</h1>
      <ul className="flex flex-col gap-1">
        {SETTINGS_SECTIONS.map((section) => (
          <li key={section}>
            <NavLink
              to={`/settings/${section}`}
              className={({ isActive }) =>
                `flex min-h-[44px] items-center justify-between rounded-md px-3 text-base ${isActive ? 'bg-surface-3 font-medium' : 'hover:bg-surface-3'}`
              }
            >
              {vi.settings.sections[section]}
              <ChevronRight size={20} aria-hidden="true" className="text-text-secondary md:hidden" />
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button
          variant="secondary"
          loading={logout.isPending}
          onClick={() => {
            logout.mutate();
          }}
        >
          <LogOut size={20} aria-hidden="true" />
          {vi.settings.logout}
        </Button>
      </div>
    </nav>
  );
}
