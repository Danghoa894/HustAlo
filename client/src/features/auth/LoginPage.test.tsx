import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { authResponse, calledPath, errorResponse, jsonResponse, requestBody } from '../../test/fixtures';
import { currentPath, renderPage } from '../../test/render';
import { LoginPage } from './LoginPage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(t.auth.email), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(t.auth.password), { target: { value: password } });
}
const submit = () => {
  fireEvent.click(screen.getByRole('button', { name: t.auth.submitLogin }));
};

describe('LoginPage (ui_ux_spec.md §3.1)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: null, expiresAt: null, user: null, bootstrapped: true, sessionEnded: null });
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('đăng nhập thành công → POST /auth/login {email, password, deviceId}, lưu phiên, tới next hợp lệ', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, authResponse('tok-login')));
    renderPage(<LoginPage />, { path: '/login', at: '/login?next=%2Fsettings%2Fprofile' });
    fill('Alice@Hustalo.local', 'Secret123');
    submit();
    await waitFor(() => {
      expect(currentPath()).toBe('/settings/profile');
    });
    expect(calledPath(fetchMock, 0)).toBe('/auth/login');
    const body = requestBody(fetchMock, 0) as Record<string, string>;
    expect(body).toMatchObject({ email: 'Alice@Hustalo.local', password: 'Secret123' });
    expect(body.deviceId).toMatch(UUID);
    expect(useAuthStore.getState().accessToken).toBe('tok-login');
  });

  it('next độc hại bị bỏ qua → /chats', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, authResponse()));
    renderPage(<LoginPage />, { path: '/login', at: '/login?next=%2F%2Fevil.example' });
    fill('alice@hustalo.local', 'Secret123');
    submit();
    await waitFor(() => {
      expect(currentPath()).toBe('/chats');
    });
  });

  it('TC-AC-003 401 → FormError "Email hoặc mật khẩu không đúng" (role=alert)', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'UNAUTHENTICATED'));
    renderPage(<LoginPage />, { path: '/login' });
    fill('alice@hustalo.local', 'wrong-pass1');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(t.auth.invalidCredentials);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('TC-SEC-005 429 → đếm ngược theo Retry-After, nút đăng nhập disabled tới hết', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValueOnce(errorResponse(429, 'RATE_LIMITED', { headers: { 'Retry-After': '3' } }));
    renderPage(<LoginPage />, { path: '/login' });
    fill('alice@hustalo.local', 'wrong-pass1');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(t.auth.rateLimited(3));
    const button = screen.getByRole('button', { name: t.auth.submitLogin });
    expect(button).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(t.auth.rateLimited(2));
    for (const _ of [1, 2]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(screen.queryByRole('alert')).toBeNull();
    expect(button).toBeEnabled();
  });

  it('503 → "Máy chủ đang bận, vui lòng thử lại"; lỗi mạng → "Không có kết nối mạng"', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(503, 'SERVICE_UNAVAILABLE'));
    renderPage(<LoginPage />, { path: '/login' });
    fill('alice@hustalo.local', 'Secret123');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(t.auth.serverBusy);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    submit();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(t.auth.offline);
    });
  });

  it('validate client bằng schema shared: submit trống → lỗi dưới trường, focus trường lỗi đầu, không gọi API', () => {
    renderPage(<LoginPage />, { path: '/login' });
    submit();
    expect(fetchMock).not.toHaveBeenCalled();
    const email = screen.getByLabelText(t.auth.email);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveFocus();
    expect(screen.getAllByText(t.common.required)).toHaveLength(2);
  });

  it('email sai định dạng: lỗi hiện khi blur', () => {
    renderPage(<LoginPage />, { path: '/login' });
    const email = screen.getByLabelText(t.auth.email);
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    expect(screen.queryByText(t.auth.invalidEmail)).toBeNull();
    fireEvent.blur(email);
    expect(screen.getByText(t.auth.invalidEmail)).toBeInTheDocument();
  });

  it('đang gửi: nút "Đang đăng nhập…" và form aria-busy', async () => {
    let resolve: (r: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderPage(<LoginPage />, { path: '/login' });
    fill('alice@hustalo.local', 'Secret123');
    submit();
    expect(await screen.findByRole('button', { name: t.auth.submittingLogin })).toBeDisabled();
    expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'true');
    resolve(jsonResponse(200, authResponse()));
    await waitFor(() => {
      expect(currentPath()).toBe('/chats');
    });
  });

  it('nút hiện/ẩn mật khẩu có aria-label', () => {
    renderPage(<LoginPage />, { path: '/login' });
    const pw = screen.getByLabelText(t.auth.password);
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: t.common.showPassword }));
    expect(pw).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: t.common.hidePassword })).toBeInTheDocument();
  });
});
