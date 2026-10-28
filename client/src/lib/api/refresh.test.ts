import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth.store';
import { authResponse, calledPath, errorResponse, jsonResponse } from '../../test/fixtures';
import { bootstrapSession, refreshAccessToken, resetRefreshStateForTest } from './refresh';

describe('lib/api/refresh (D-19)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: null, expiresAt: null, user: null, bootstrapped: false, sessionEnded: null });
    document.cookie = 'hustalo_csrf=csrf-1; path=/';
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    resetRefreshStateForTest();
    document.cookie = 'hustalo_csrf=; Max-Age=0; path=/';
  });

  it('POST /auth/refresh kèm X-CSRF-Token, lưu phiên mới vào auth store (chỉ RAM)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, authResponse('fresh')));
    await expect(refreshAccessToken()).resolves.toBe('fresh');
    expect(calledPath(fetchMock, 0)).toBe('/auth/refresh');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-1');
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
    expect(useAuthStore.getState().accessToken).toBe('fresh');
    expect(useAuthStore.getState().user?.username).toBe('alice');
    expect(localStorage.length).toBe(0);
  });

  it('TC-AUTH-003 nhiều lời gọi đồng thời trong một tab chỉ gửi một request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, authResponse('once')));
    const [a, b, c] = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()]);
    expect([a, b, c]).toEqual(['once', 'once', 'once']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('TC-AUTH-003 chạy trong Web Lock "hustalo-refresh" khi trình duyệt hỗ trợ', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<unknown>) => cb());
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    try {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, authResponse('locked')));
      await expect(refreshAccessToken()).resolves.toBe('locked');
      expect(request).toHaveBeenCalledWith('hustalo-refresh', expect.any(Function));
    } finally {
      Reflect.deleteProperty(navigator, 'locks');
    }
  });

  it('TC-AC-007 409 CONFLICT (tab khác vừa xoay) → thử lại đúng 1 lần và thành công', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(409, 'CONFLICT'))
      .mockResolvedValueOnce(jsonResponse(200, authResponse('after-retry')));
    await expect(refreshAccessToken()).resolves.toBe('after-retry');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().accessToken).toBe('after-retry');
  });

  it('TC-AC-007 409 hai lần liên tiếp → null, không thử thêm, không xóa phiên đang có', async () => {
    useAuthStore.setState({ accessToken: 'current' });
    fetchMock.mockResolvedValue(errorResponse(409, 'CONFLICT'));
    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().accessToken).toBe('current');
  });

  it('401 UNAUTHENTICATED → null (phiên không còn hợp lệ)', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'UNAUTHENTICATED'));
    await expect(refreshAccessToken()).resolves.toBeNull();
  });

  it('bootstrapSession: refresh một lần lúc khởi động rồi đánh dấu bootstrapped, kể cả khi 401', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'UNAUTHENTICATED'));
    await Promise.all([bootstrapSession(), bootstrapSession()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().bootstrapped).toBe(true);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('bootstrapSession: lỗi mạng vẫn kết thúc bootstrap (về /login thay vì treo Spinner)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await bootstrapSession();
    expect(useAuthStore.getState().bootstrapped).toBe(true);
  });
});
