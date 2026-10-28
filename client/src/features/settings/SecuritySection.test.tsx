import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { calledPath, errorResponse, requestBody, userMe } from '../../test/fixtures';
import { renderPage } from '../../test/render';
import { SecuritySection } from './SecuritySection';

const s = t.settings.security;
const change = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
function fill(current = 'OldSecret1', next = 'NewSecret2', confirm = next) {
  change(s.currentPassword, current);
  change(s.newPassword, next);
  change(s.confirmNewPassword, confirm);
}
const submit = () => {
  fireEvent.click(screen.getByRole('button', { name: s.changePassword }));
};

describe('SecuritySection — đổi mật khẩu (ui_ux_spec.md §3.8, FR-AUTH-005)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true, sessionEnded: null });
    useUiStore.setState({ toasts: [] });
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('TC-AUTH-006 thành công (204) → POST /auth/change-password, toast "Đã đổi mật khẩu" + "Các thiết bị khác đã được đăng xuất."', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    renderPage(<SecuritySection />, { path: '/settings/security' });
    fill();
    submit();
    await waitFor(() => {
      expect(useUiStore.getState().toasts).toHaveLength(1);
    });
    expect(useUiStore.getState().toasts[0]).toMatchObject({
      tone: 'success',
      text: s.changed,
      description: s.othersLoggedOut,
    });
    expect(calledPath(fetchMock, 0)).toBe('/auth/change-password');
    expect(requestBody(fetchMock, 0)).toEqual({
      currentPassword: 'OldSecret1',
      newPassword: 'NewSecret2',
    });
    expect(screen.getByLabelText(s.currentPassword)).toHaveValue('');
    expect(useAuthStore.getState().accessToken).toBe('tok');
  });

  it('TC-AUTH-008 422 currentPassword INVALID → lỗi inline tại "Mật khẩu hiện tại", không refresh/đăng xuất', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(422, 'VALIDATION_ERROR', { details: [{ field: 'currentPassword', reason: 'INVALID' }] }),
    );
    renderPage(<SecuritySection />, { path: '/settings/security' });
    fill('WrongOld1');
    submit();
    expect(await screen.findByText(s.wrongCurrentPassword)).toBeInTheDocument();
    expect(screen.getByLabelText(s.currentPassword)).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBe('tok');
    expect(useAuthStore.getState().sessionEnded).toBeNull();
  });

  it('TC-AC-018 429 → "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau {n} giây.", nút disabled', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(429, 'RATE_LIMITED', { headers: { 'Retry-After': '840' } }));
    renderPage(<SecuritySection />, { path: '/settings/security' });
    fill();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(t.auth.rateLimited(840));
    expect(screen.getByRole('button', { name: s.changePassword })).toBeDisabled();
  });

  it('mật khẩu mới yếu hoặc nhập lại không khớp → lỗi, không gọi API', () => {
    renderPage(<SecuritySection />, { path: '/settings/security' });
    fill('OldSecret1', 'short', 'short');
    submit();
    expect(screen.getByText(t.auth.invalidPassword)).toBeInTheDocument();
    fill('OldSecret1', 'NewSecret2', 'NewSecret3');
    submit();
    expect(screen.getByText(t.auth.passwordMismatch)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
