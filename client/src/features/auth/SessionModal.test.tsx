import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore, type SessionEndReason } from '../../stores/auth.store';
import { SessionModal } from './SessionModal';

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function mount() {
  render(
    <MemoryRouter initialEntries={['/chats']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SessionModal />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SessionModal (ui_ux_spec.md §3.9)', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, sessionEnded: null, bootstrapped: true });
  });

  it('không có lý do → không render', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['TC-AUTH-004', 'REFRESH_REUSE', 'Phiên đăng nhập đã bị thu hồi vì lý do bảo mật. Vui lòng đăng nhập lại.'],
    ['TC-AUTH-005', 'ACCOUNT_LOCKED', 'Tài khoản của bạn đã bị khóa.'],
    ['TC-AUTH-006', 'PASSWORD_CHANGED', 'Mật khẩu đã được thay đổi. Vui lòng đăng nhập lại.'],
    ['TC-AUTH-006', 'DEVICE_REVOKED', 'Thiết bị này đã bị thu hồi. Vui lòng đăng nhập lại.'],
    ['TC-AUTH-002', 'EXPIRED', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'],
  ] as const)('%s %s → văn bản nguyên văn spec', (_id, reason: SessionEndReason, text) => {
    useAuthStore.setState({ sessionEnded: reason });
    mount();
    expect(screen.getByRole('dialog')).toHaveTextContent(text);
  });

  it('không đóng bằng Esc; "Đăng nhập lại" → xóa lý do, về /login', () => {
    useAuthStore.setState({ sessionEnded: 'ACCOUNT_LOCKED' });
    mount();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.session.relogin }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useAuthStore.getState().sessionEnded).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('/login');
  });
});
