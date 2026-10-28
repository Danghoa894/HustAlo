import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { resetRefreshStateForTest } from '../../lib/api/refresh';
import { useAuthStore } from '../../stores/auth.store';
import { authResponse, errorResponse, jsonResponse } from '../../test/fixtures';
import { ROUTER_FUTURE } from '../../test/render';
import { RedirectIfAuthed } from './RedirectIfAuthed';
import { RequireAuth } from './RequireAuth';
import { safeNext } from './safe-next';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <Where />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/chats/*"
          element={
            <RequireAuth>
              <Where />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.queryByTestId('where')?.textContent ?? null;
}

describe('route guard (ui_ux_spec.md §2)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: null, bootstrapped: true, signedOut: false });
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    resetRefreshStateForTest();
  });

  it('safeNext chỉ nhận đường dẫn nội bộ (chống open redirect)', () => {
    expect(safeNext('/chats/abc?x=1')).toBe('/chats/abc?x=1');
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });

  it('RequireAuth chưa đăng nhập → /login?next=<đường dẫn hiện tại>', () => {
    expect(renderAt('/chats/6720a1b2c3d4e5f601234561')).toBe(
      `/login?next=${encodeURIComponent('/chats/6720a1b2c3d4e5f601234561')}`,
    );
  });

  it('TC-AC-007 RequireAuth khi khởi động (reload): Spinner "Đang tải…" → /auth/refresh một lần → render', async () => {
    useAuthStore.setState({ bootstrapped: false });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, authResponse('boot')));
    expect(renderAt('/chats')).toBeNull();
    expect(screen.getByText(t.app.loading)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('where').textContent).toBe('/chats');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBe('boot');
  });

  it('RequireAuth khi khởi động, refresh 401 → /login?next=', async () => {
    useAuthStore.setState({ bootstrapped: false });
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'UNAUTHENTICATED'));
    renderAt('/chats/abc');
    await waitFor(() => {
      expect(screen.getByTestId('where').textContent).toBe(`/login?next=${encodeURIComponent('/chats/abc')}`);
    });
  });

  it('đăng xuất chủ động (signOut) → /login không kèm ?next=', () => {
    useAuthStore.setState({ accessToken: 't' });
    useAuthStore.getState().signOut();
    expect(renderAt('/chats/abc')).toBe('/login');
  });

  it('RedirectIfAuthed đã đăng nhập → next hợp lệ, next độc hại → /chats', () => {
    useAuthStore.setState({ accessToken: 't' });
    expect(renderAt('/login?next=%2Fchats%2Fabc')).toBe('/chats/abc');
  });

  it('RedirectIfAuthed với next độc hại → /chats', () => {
    useAuthStore.setState({ accessToken: 't' });
    expect(renderAt('/login?next=%2F%2Fevil.example')).toBe('/chats');
  });
});
