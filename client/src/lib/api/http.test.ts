import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth.store';
import { ApiError, NetworkError, http, setTokenRefresher } from './http';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('lib/api/http', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: null });
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    setTokenRefresher(null);
    document.cookie = 'hustalo_csrf=; Max-Age=0; path=/';
  });

  const headersOf = (call: number) => new Headers(fetchMock.mock.calls[call]?.[1]?.headers);

  it('gắn Bearer từ auth store (token chỉ trong RAM) và base /api/v1', async () => {
    useAuthStore.setState({ accessToken: 'tok-123' });
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(http('/health')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/health');
    expect(headersOf(0).get('Authorization')).toBe('Bearer tok-123');
    expect(localStorage.length).toBe(0);
  });

  it('auth:false không gắn Bearer; csrf:true gửi X-CSRF-Token từ cookie hustalo_csrf', async () => {
    useAuthStore.setState({ accessToken: 'tok-123' });
    document.cookie = 'hustalo_csrf=csrf-abc; path=/';
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await http('/auth/refresh', { method: 'POST', auth: false, csrf: true });
    expect(headersOf(0).get('Authorization')).toBeNull();
    expect(headersOf(0).get('X-CSRF-Token')).toBe('csrf-abc');
  });

  it('ErrorResponse → ApiError có code, status, requestId', async () => {
    fetchMock.mockResolvedValueOnce(
      json(404, { error: { code: 'NOT_FOUND', message: 'Không tìm thấy', requestId: 'r-1' } }),
    );
    const err = (await http('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.requestId).toBe('r-1');
  });

  it('TOKEN_EXPIRED → gọi refresher một lần rồi thử lại với token mới', async () => {
    useAuthStore.setState({ accessToken: 'old' });
    const refresher = vi.fn(() => Promise.resolve('new'));
    setTokenRefresher(refresher);
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_EXPIRED', message: 'x', requestId: 'r' } }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    await expect(http('/me')).resolves.toEqual({ ok: true });
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(headersOf(1).get('Authorization')).toBe('Bearer new');
  });

  it('fetch lỗi mạng → NetworkError (không phải ErrorCode của server)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(http('/x')).rejects.toBeInstanceOf(NetworkError);
  });
});
