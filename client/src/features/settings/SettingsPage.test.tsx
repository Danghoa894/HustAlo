import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { calledPath, jsonResponse, urlOf, userMe } from '../../test/fixtures';
import { currentPath, renderPage } from '../../test/render';
import { SettingsPage } from './SettingsPage';

describe('SettingsPage (ui_ux_spec.md §3.8)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let logoutReply: () => Promise<Response>;
  const logoutCall = () => fetchMock.mock.calls.findIndex(([u]) => urlOf(u).endsWith('/auth/logout'));

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true, sessionEnded: null });
    useUiStore.setState({ toasts: [] });
    logoutReply = () => Promise.resolve(new Response(null, { status: 204 }));
    fetchMock.mockImplementation((input) =>
      urlOf(input).endsWith('/auth/logout') ? logoutReply() : Promise.resolve(jsonResponse(200, userMe())),
    );
    document.cookie = 'hustalo_csrf=csrf-9; path=/';
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    document.cookie = 'hustalo_csrf=; Max-Age=0; path=/';
  });

  it('SettingsNav (role=navigation) có Hồ sơ, Bảo mật, Đăng xuất; mục đang mở có aria-current', () => {
    renderPage(<SettingsPage />, { path: '/settings/:section', at: '/settings/security' });
    const nav = screen.getByRole('navigation', { name: t.settings.title });
    expect(nav).toHaveTextContent(t.settings.sections.profile);
    expect(screen.getByRole('link', { name: t.settings.sections.security })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: t.settings.logout })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t.settings.security.changePassword })).toBeInTheDocument();
  });

  it('section chưa hỗ trợ (Giao diện) → chuyển về /settings/profile', async () => {
    renderPage(<SettingsPage />, { path: '/settings/:section', at: '/settings/appearance' });
    expect(await screen.findByRole('heading', { name: t.settings.sections.profile, level: 2 })).toBeInTheDocument();
  });

  it('FR-AUTH-004 đăng xuất → POST /auth/logout kèm CSRF, xóa phiên, về /login', async () => {
    renderPage(<SettingsPage />, { path: '/settings/:section', at: '/settings/profile' });
    fireEvent.click(screen.getByRole('button', { name: t.settings.logout }));
    await waitFor(() => {
      expect(currentPath()).toBe('/login');
    });
    expect(calledPath(fetchMock, logoutCall())).toBe('/auth/logout');
    expect(new Headers(fetchMock.mock.calls[logoutCall()]?.[1]?.headers).get('X-CSRF-Token')).toBe('csrf-9');
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().sessionEnded).toBeNull();
  });

  it('đăng xuất lỗi mạng → toast lỗi, giữ phiên (refresh cookie chưa bị thu hồi)', async () => {
    logoutReply = () => Promise.reject(new TypeError('Failed to fetch'));
    renderPage(<SettingsPage />, { path: '/settings/:section', at: '/settings/profile' });
    fireEvent.click(screen.getByRole('button', { name: t.settings.logout }));
    await waitFor(() => {
      expect(useUiStore.getState().toasts[0]).toMatchObject({ tone: 'error', text: t.auth.offline });
    });
    expect(useAuthStore.getState().accessToken).toBe('tok');
  });
});
