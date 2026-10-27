// client/src/lib/api/http.ts — fetch wrapper: Bearer, X-CSRF-Token, ErrorResponse → ApiError (kiến trúc §6.3).
// Refresh một lần khi TOKEN_EXPIRED: M1 đăng ký hàm refresh qua setTokenRefresher (lib/api/refresh.ts, D-19).
import type { ErrorCode, ErrorResponse } from '@hustalo/shared';
import { useAuthStore } from '../../stores/auth.store';

export const API_BASE: string = import.meta.env.VITE_API_URL ?? '/api/v1';
const CSRF_COOKIE = 'hustalo_csrf';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

/** Không gửi được request (mất mạng, DNS…): không phải ErrorCode của server. */
export class NetworkError extends Error {
  override name = 'NetworkError';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Gửi X-CSRF-Token (chỉ /auth/refresh và /auth/logout). */
  csrf?: boolean;
  /** false: không gắn Bearer (đăng nhập, đăng ký, refresh). */
  auth?: boolean;
  signal?: AbortSignal;
}

type TokenRefresher = () => Promise<string | null>;
let refresher: TokenRefresher | null = null;

export function setTokenRefresher(fn: TokenRefresher | null): void {
  refresher = fn;
}

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  if (opts.csrf) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  try {
    return await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch {
    throw new NetworkError('fetch failed');
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ErrorResponse>;
    if (body.error) {
      return new ApiError(res.status, body.error.code, body.error.message, body.error.details, body.error.requestId);
    }
  } catch {
    // body không phải JSON
  }
  return new ApiError(res.status, 'INTERNAL_ERROR', res.statusText);
}

export async function http<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts, useAuthStore.getState().accessToken);
  if (!res.ok) {
    const err = await toApiError(res);
    if (err.code === 'TOKEN_EXPIRED' && opts.auth !== false && refresher) {
      const fresh = await refresher();
      if (!fresh) throw err;
      res = await send(path, opts, fresh);
      if (!res.ok) throw await toApiError(res);
    } else {
      throw err;
    }
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
