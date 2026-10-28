import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { authResponse, calledPath, errorResponse, jsonResponse, requestBody } from '../../test/fixtures';
import { currentPath, renderPage } from '../../test/render';
import { RegisterPage } from './RegisterPage';

const change = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

function fillValid() {
  change(t.auth.email, 'dave@example.com');
  change(t.auth.username, 'dave');
  change(t.auth.displayName, 'Dave Phạm');
  change(t.auth.password, 'Secret123');
  change(t.auth.confirmPassword, 'Secret123');
}
const submit = () => {
  fireEvent.click(screen.getByRole('button', { name: t.auth.submitRegister }));
};

describe('RegisterPage (ui_ux_spec.md §3.1)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: null, expiresAt: null, user: null, bootstrapped: true, sessionEnded: null });
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('đăng ký thành công → POST /auth/register (không gửi confirm), lưu phiên, về /chats', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, authResponse('tok-reg')));
    renderPage(<RegisterPage />, { path: '/register' });
    fillValid();
    submit();
    await waitFor(() => {
      expect(currentPath()).toBe('/chats');
    });
    expect(calledPath(fetchMock, 0)).toBe('/auth/register');
    const body = requestBody(fetchMock, 0) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['deviceId', 'displayName', 'email', 'password', 'username']);
    expect(useAuthStore.getState().accessToken).toBe('tok-reg');
  });

  it('username tự chuyển chữ thường, có gợi ý định dạng', () => {
    renderPage(<RegisterPage />, { path: '/register' });
    change(t.auth.username, 'Dave.Pham');
    expect(screen.getByLabelText(t.auth.username)).toHaveValue('dave.pham');
    expect(screen.getByText(t.auth.usernameHint)).toBeInTheDocument();
    expect(screen.getByText(t.auth.passwordHint)).toBeInTheDocument();
  });

  it.each([
    ['email', t.auth.email, t.auth.emailTaken],
    ['username', t.auth.username, t.auth.usernameTaken],
  ])(
    'TC-AUTH-001 409 CONFLICT details.field=%s → lỗi inline tại trường, focus trường đó',
    async (field, label, msg) => {
      fetchMock.mockResolvedValueOnce(errorResponse(409, 'CONFLICT', { details: { field } }));
      renderPage(<RegisterPage />, { path: '/register' });
      fillValid();
      submit();
      expect(await screen.findByText(msg)).toBeInTheDocument();
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveFocus();
      // Sửa trường → lỗi server biến mất
      change(label, field === 'email' ? 'dave2@example.com' : 'dave2');
      expect(screen.queryByText(msg)).toBeNull();
    },
  );

  it('nhập lại mật khẩu không khớp → lỗi, không gọi API', () => {
    renderPage(<RegisterPage />, { path: '/register' });
    fillValid();
    change(t.auth.confirmPassword, 'Secret124');
    submit();
    expect(screen.getByText(t.auth.passwordMismatch)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mật khẩu yếu → "Mật khẩu cần ít nhất 8 ký tự, gồm chữ và số"', () => {
    renderPage(<RegisterPage />, { path: '/register' });
    fillValid();
    change(t.auth.password, 'abcdefgh');
    change(t.auth.confirmPassword, 'abcdefgh');
    submit();
    expect(screen.getByText(t.auth.invalidPassword)).toBeInTheDocument();
  });

  it('displayName: bộ đếm chỉ hiện khi còn ≤ 20 ký tự', () => {
    renderPage(<RegisterPage />, { path: '/register' });
    change(t.auth.displayName, 'a'.repeat(59));
    expect(screen.queryByText('59/80')).toBeNull();
    change(t.auth.displayName, 'a'.repeat(60));
    expect(screen.getByText('60/80')).toBeInTheDocument();
  });

  it('TC-SEC-005 429 → "Bạn đã thử quá nhiều lần…" theo Retry-After, nút disabled', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(429, 'RATE_LIMITED', { headers: { 'Retry-After': '30' } }));
    renderPage(<RegisterPage />, { path: '/register' });
    fillValid();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(t.auth.rateLimited(30));
    expect(screen.getByRole('button', { name: t.auth.submitRegister })).toBeDisabled();
  });
});
