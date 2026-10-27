import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../../stores/auth.store';
import { RedirectIfAuthed } from './RedirectIfAuthed';
import { RequireAuth } from './RequireAuth';
import { safeNext } from './safe-next';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
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
  return screen.getByTestId('where').textContent;
}

describe('route guard (ui_ux_spec.md §2)', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null });
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

  it('RedirectIfAuthed đã đăng nhập → next hợp lệ, next độc hại → /chats', () => {
    useAuthStore.setState({ accessToken: 't' });
    expect(renderAt('/login?next=%2Fchats%2Fabc')).toBe('/chats/abc');
  });

  it('RedirectIfAuthed với next độc hại → /chats', () => {
    useAuthStore.setState({ accessToken: 't' });
    expect(renderAt('/login?next=%2F%2Fevil.example')).toBe('/chats');
  });
});
