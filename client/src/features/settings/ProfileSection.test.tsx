import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { calledPath, errorResponse, jsonResponse, requestBody, urlOf, userMe } from '../../test/fixtures';
import { renderPage } from '../../test/render';
import { ProfileSection } from './ProfileSection';

const nameInput = () => screen.getByLabelText(t.settings.profile.displayName);
const save = () => {
  fireEvent.click(screen.getByRole('button', { name: t.common.save }));
};

describe('ProfileSection (ui_ux_spec.md §3.8, FR-USER-002)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true });
    useUiStore.setState({ toasts: [] });
    fetchMock.mockImplementation((input) =>
      Promise.resolve(urlOf(input).endsWith('/auth/me') ? jsonResponse(200, userMe()) : jsonResponse(500, {})),
    );
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('hiển thị hồ sơ từ Q["me"]; username và email chỉ đọc', async () => {
    renderPage(<ProfileSection />, { path: '/settings/profile' });
    expect(await screen.findByDisplayValue('Alice Nguyễn')).toBe(nameInput());
    expect(screen.getByLabelText(t.settings.profile.username)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(t.settings.profile.email)).toHaveAttribute('readonly');
  });

  it('TC-AC-013 displayName 81 ký tự → lỗi dưới trường, không gọi PATCH', async () => {
    renderPage(<ProfileSection />, { path: '/settings/profile' });
    await screen.findByDisplayValue('Alice Nguyễn');
    fireEvent.change(nameInput(), { target: { value: 'a'.repeat(81) } });
    save();
    expect(screen.getByText('Tên hiển thị tối đa 80 ký tự')).toBeInTheDocument();
    expect(screen.getByText('81/80')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => urlOf(u).endsWith('/users/me'))).toBe(false);
  });

  it('D-26 không có ô nhập ảnh đại diện; avatarUrl sẵn có không bị gửi lại khi lưu tên', async () => {
    const withAvatar = userMe({ avatarUrl: 'https://cdn.example/a.png' });
    useAuthStore.setState({ user: withAvatar });
    fetchMock.mockImplementation((input) =>
      Promise.resolve(urlOf(input).endsWith('/auth/me') ? jsonResponse(200, withAvatar) : jsonResponse(500, {})),
    );
    renderPage(<ProfileSection />, { path: '/settings/profile' });
    await screen.findByDisplayValue('Alice Nguyễn');
    expect(screen.queryByLabelText(/Ảnh đại diện/)).toBeNull();
    expect(screen.queryByDisplayValue('https://cdn.example/a.png')).toBeNull();
    expect(screen.getAllByRole('textbox')).toHaveLength(3); // tên hiển thị, tên người dùng, email

    fetchMock.mockResolvedValueOnce(jsonResponse(200, userMe({ displayName: 'Alice Mới' })));
    fireEvent.change(nameInput(), { target: { value: 'Alice Mới' } });
    save();
    await waitFor(() => {
      expect(useAuthStore.getState().user?.displayName).toBe('Alice Mới');
    });
    const i = fetchMock.mock.calls.findIndex(([u]) => urlOf(u).endsWith('/users/me'));
    expect(requestBody(fetchMock, i)).toEqual({ displayName: 'Alice Mới' });
  });

  it('TC-AC-013 lưu tên mới → PATCH /users/me chỉ trường đổi, cập nhật store, toast "Đã lưu thay đổi"', async () => {
    renderPage(<ProfileSection />, { path: '/settings/profile' });
    await screen.findByDisplayValue('Alice Nguyễn');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, userMe({ displayName: 'Alice Mới' })));
    fireEvent.change(nameInput(), { target: { value: 'Alice Mới' } });
    save();
    await waitFor(() => {
      expect(useAuthStore.getState().user?.displayName).toBe('Alice Mới');
    });
    const i = fetchMock.mock.calls.findIndex(([u]) => urlOf(u).endsWith('/users/me'));
    expect(calledPath(fetchMock, i)).toBe('/users/me');
    expect(fetchMock.mock.calls[i]?.[1]?.method).toBe('PATCH');
    expect(requestBody(fetchMock, i)).toEqual({ displayName: 'Alice Mới' });
    expect(useUiStore.getState().toasts[0]).toMatchObject({ tone: 'success', text: t.settings.saved });
  });

  it('VALIDATION_ERROR từ server → lỗi dưới trường tương ứng', async () => {
    renderPage(<ProfileSection />, { path: '/settings/profile' });
    await screen.findByDisplayValue('Alice Nguyễn');
    fetchMock.mockResolvedValueOnce(
      errorResponse(400, 'VALIDATION_ERROR', { details: [{ path: 'displayName', message: 'Invalid' }] }),
    );
    fireEvent.change(nameInput(), { target: { value: 'Alice Khác' } });
    save();
    expect(await screen.findByText(t.common.required)).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
  });
});
