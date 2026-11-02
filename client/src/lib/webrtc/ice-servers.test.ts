// Unit: ice-servers.ts — cache GET /calls/ice-servers tới expiresAt - TURN_REFRESH_BEFORE_S (kiến trúc §9.5,
// EC-CALL-NET-005); lấy mới trước mỗi ICE restart khi credential sắp hết hạn.
import type { IceServersResponse } from '@hustalo/shared';
import { describe, expect, it, vi } from 'vitest';
import { createIceServersCache } from './ice-servers';

const T0 = Date.parse('2026-10-27T10:00:00.000Z');
const res = (expiresAt: string, user = 'u'): IceServersResponse => ({
  iceServers: [{ urls: ['turn:x:3478'], username: user, credential: 'c' }],
  iceTransportPolicy: 'all',
  expiresAt,
  source: 'FALLBACK',
});

describe('ice-servers cache (FR-CALL-007)', () => {
  it('TC-CALL-NET-005 còn ≥ 5 phút → dùng cache; còn < 5 phút → lấy credential mới', async () => {
    let now = T0;
    const fetch = vi
      .fn<() => Promise<IceServersResponse>>()
      .mockResolvedValueOnce(res('2026-10-27T11:00:00.000Z', 'u1'))
      .mockResolvedValueOnce(res('2026-10-27T12:00:00.000Z', 'u2'));
    const cache = createIceServersCache({ fetch, now: () => now });
    expect((await cache.get()).iceServers[0]?.username).toBe('u1');
    now = T0 + 54 * 60_000; // còn 6 phút
    expect((await cache.get()).iceServers[0]?.username).toBe('u1');
    now = T0 + 56 * 60_000; // còn 4 phút
    expect((await cache.get()).iceServers[0]?.username).toBe('u2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('TC-CALL-NET-005 forRestart(): credential sắp hết → lấy mới; còn hạn → dùng lại (setConfiguration trước ICE restart)', async () => {
    let now = T0;
    const fetch = vi.fn(() => Promise.resolve(res(new Date(now + 3600_000).toISOString())));
    const cache = createIceServersCache({ fetch, now: () => now });
    await cache.get();
    await cache.forRestart();
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 58 * 60_000;
    await cache.forRestart();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('hai lời gọi đồng thời chỉ gửi một request; lỗi không bị cache', async () => {
    const fetch = vi
      .fn<() => Promise<IceServersResponse>>()
      .mockRejectedValueOnce(new Error('mạng'))
      .mockResolvedValue(res('2026-10-27T11:00:00.000Z'));
    const cache = createIceServersCache({ fetch, now: () => T0 });
    await expect(cache.get()).rejects.toThrow('mạng');
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
