// client/src/test/fixtures.ts — dữ liệu mẫu và helper fetch giả cho unit test client
import type { AuthResponse, ErrorCode, UserMe } from '@hustalo/shared';

export const userMe = (over: Partial<UserMe> = {}): UserMe => ({
  id: '6720a1b2c3d4e5f601234561',
  email: 'alice@hustalo.local',
  username: 'alice',
  displayName: 'Alice Nguyễn',
  avatarUrl: null,
  privacy: { showLastSeen: true },
  blockedUserIds: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

export const authResponse = (token = 'tok-1', ttlMs = 15 * 60_000): AuthResponse => ({
  accessToken: token,
  accessTokenExpiresAt: new Date(Date.now() + ttlMs).toISOString(),
  user: userMe(),
});

export const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export const errorResponse = (
  status: number,
  code: ErrorCode,
  extra: { details?: unknown; headers?: Record<string, string> } = {},
) =>
  jsonResponse(
    status,
    {
      error: {
        code,
        message: 'server message',
        requestId: 'req-1',
        ...(extra.details ? { details: extra.details } : {}),
      },
    },
    extra.headers,
  );

/** URL đã gọi (bỏ base /api/v1) của lần gọi thứ `i`. */
export const calledPath = (mock: { mock: { calls: unknown[][] } }, i: number): string =>
  String(mock.mock.calls[i]?.[0]).replace(/^\/api\/v1/, '');

/** URL của đối số đầu tiên của fetch (string | URL | Request). */
export const urlOf = (input: unknown): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : '';

/** Body JSON của lần gọi fetch thứ `i`. */
export const requestBody = (mock: { mock: { calls: unknown[][] } }, i: number): unknown => {
  const body = (mock.mock.calls[i]?.[1] as RequestInit | undefined)?.body;
  return typeof body === 'string' ? (JSON.parse(body) as unknown) : undefined;
};
