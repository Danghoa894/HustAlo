// client/src/lib/api/refresh.ts — xoay access token qua POST /auth/refresh (kiến trúc §7(a), D-19).
// - Web Locks 'hustalo-refresh': mỗi lúc chỉ một tab refresh (EC-AUTH-003).
// - Trong một tab: gộp các lời gọi đồng thời thành một request.
// - 409 CONFLICT (tab khác vừa xoay, cookie đã đổi) → thử lại đúng 1 lần (AC-007).
// - 401/403 → null; người gọi quyết định đăng xuất hay mở SessionModal.
import type { AuthResponse } from '@hustalo/shared';
import { useAuthStore } from '../../stores/auth.store';
import { ApiError, http, setTokenRefresher } from './http';

const LOCK_NAME = 'hustalo-refresh';

let inflight: Promise<string | null> | null = null;
let bootstrapping: Promise<void> | null = null;

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks ? (locks.request(LOCK_NAME, fn) as Promise<T>) : fn();
}

const postRefresh = () => http<AuthResponse>('/auth/refresh', { method: 'POST', auth: false, csrf: true });

async function doRefresh(): Promise<string | null> {
  let res: AuthResponse;
  try {
    res = await postRefresh();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.code !== 'CONFLICT') {
      if (err.status === 401 || err.status === 403) return null;
      throw err;
    }
    try {
      res = await postRefresh();
    } catch (retryErr) {
      if (
        retryErr instanceof ApiError &&
        (retryErr.status === 401 || retryErr.status === 403 || retryErr.status === 409)
      ) {
        return null;
      }
      throw retryErr;
    }
  }
  useAuthStore.getState().setSession(res);
  return res.accessToken;
}

export function refreshAccessToken(): Promise<string | null> {
  inflight ??= withLock(doRefresh).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** RequireAuth: thử refresh một lần lúc khởi động app (ui_ux_spec.md §2). Không bao giờ reject. */
export function bootstrapSession(): Promise<void> {
  bootstrapping ??= refreshAccessToken()
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      useAuthStore.getState().markBootstrapped();
    });
  return bootstrapping;
}

/** http.ts: REST trả TOKEN_EXPIRED → refresh; thất bại → SessionModal "Phiên đăng nhập đã hết hạn…". */
export function installTokenRefresher(): void {
  setTokenRefresher(async () => {
    const token = await refreshAccessToken();
    if (!token) useAuthStore.getState().endSession('EXPIRED');
    return token;
  });
}

export function resetRefreshStateForTest(): void {
  inflight = null;
  bootstrapping = null;
}
