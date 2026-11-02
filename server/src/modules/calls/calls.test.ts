// Unit: iceServers.service (kiến trúc §9.5, DG-10) với Xirsys và cache giả; parse response Xirsys (object hoặc mảng);
// calls.service với repository/port giả (log key user:incall treo, DB §5.4).
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { Emitter } from '../../realtime/emitter';
import { parseXirsysResponse, XirsysError } from '../../infra/turn/xirsys.client';
import type { CallStateRepository } from './callState.repository';
import type { CallsRepository } from './calls.repository';
import { createCallsService } from './calls.service';
import { createIceServersService, type IceConfig } from './iceServers.service';

const NOW = new Date('2026-10-27T10:00:00.000Z');
const config = (over: Partial<IceConfig> = {}): IceConfig => ({
  stunUrls: ['stun:stun.l.google.com:19302'],
  xirsys: { ident: 'id', secret: 'sec', channel: 'ch', apiUrl: 'https://x.test', timeoutMs: 3000 },
  turnFallback: { urls: ['turn:localhost:3478?transport=udp'], username: 'hustalo', credential: 'pw' },
  iceTransportPolicy: 'all',
  ...over,
});

function memCache() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: vi.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
  };
}

const xirsysOk = { iceServers: [{ urls: ['stun:x', 'turn:x:3478?transport=udp'], username: 'u', credential: 'c' }] };

describe('iceServers.service (FR-CALL-007)', () => {
  it('TC-CALL-NET-006 Xirsys lỗi → FALLBACK = STUN_URLS + coturn, metric + warn, không cache', async () => {
    const cache = memCache();
    const onFallback = vi.fn();
    const svc = createIceServersService({
      config: config(),
      cache,
      fetchXirsys: () => Promise.reject(new XirsysError('HTTP_500')),
      onFallback,
      now: () => NOW,
    });
    const res = await svc.get();
    expect(res).toEqual({
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['turn:localhost:3478?transport=udp'], username: 'hustalo', credential: 'pw' },
      ],
      iceTransportPolicy: 'all',
      expiresAt: '2026-10-27T11:00:00.000Z',
      source: 'FALLBACK',
    });
    expect(onFallback).toHaveBeenCalledWith('HTTP_500');
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('DG-10 Xirsys chưa cấu hình → FALLBACK, không gọi Xirsys, không metric/warn', async () => {
    const fetchXirsys = vi.fn();
    const onFallback = vi.fn();
    const svc = createIceServersService({
      config: config({ xirsys: { ident: '', secret: '', channel: 'ch', apiUrl: 'https://x.test', timeoutMs: 3000 } }),
      cache: memCache(),
      fetchXirsys,
      onFallback,
      now: () => NOW,
    });
    expect((await svc.get()).source).toBe('FALLBACK');
    expect(fetchXirsys).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('không có TURN fallback → chỉ STUN; iceTransportPolicy theo cấu hình', async () => {
    const svc = createIceServersService({
      config: config({
        xirsys: { ident: '', secret: '', channel: 'ch', apiUrl: 'https://x.test', timeoutMs: 3000 },
        turnFallback: { urls: [], username: '', credential: '' },
        iceTransportPolicy: 'relay',
      }),
      cache: memCache(),
      fetchXirsys: vi.fn(),
      now: () => NOW,
    });
    const res = await svc.get();
    expect(res.iceServers).toEqual([{ urls: ['stun:stun.l.google.com:19302'] }]);
    expect(res.iceTransportPolicy).toBe('relay');
  });

  it('TC-CALL-NET-005 Xirsys ok → source XIRSYS, expiresAt = fetchedAt + 1 h, cache 300 s; lần sau đọc cache, không gọi lại', async () => {
    const cache = memCache();
    const fetchXirsys = vi.fn(() => Promise.resolve(xirsysOk));
    let t = NOW.getTime();
    const svc = createIceServersService({ config: config(), cache, fetchXirsys, now: () => new Date(t) });
    const first = await svc.get();
    expect(first).toMatchObject({ source: 'XIRSYS', expiresAt: '2026-10-27T11:00:00.000Z' });
    expect(first.iceServers).toEqual(xirsysOk.iceServers);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 300);
    t += 60_000;
    const second = await svc.get();
    expect(second.expiresAt).toBe(first.expiresAt); // tính từ fetchedAt trong cache
    expect(fetchXirsys).toHaveBeenCalledTimes(1);
  });

  it('cache hỏng (JSON sai) → bỏ qua và gọi Xirsys', async () => {
    const cache = memCache();
    cache.store.set('k', '{not json');
    const fetchXirsys = vi.fn(() => Promise.resolve(xirsysOk));
    const svc = createIceServersService({
      config: config(),
      cache: { get: () => Promise.resolve('{not json'), set: cache.set },
      fetchXirsys,
      now: () => NOW,
    });
    expect((await svc.get()).source).toBe('XIRSYS');
    expect(fetchXirsys).toHaveBeenCalledTimes(1);
  });

  it('cache Redis lỗi khi đọc/ghi → vẫn trả kết quả (không làm hỏng request)', async () => {
    const svc = createIceServersService({
      config: config(),
      cache: { get: () => Promise.reject(new Error('down')), set: () => Promise.reject(new Error('down')) },
      fetchXirsys: () => Promise.resolve(xirsysOk),
      now: () => NOW,
    });
    expect((await svc.get()).source).toBe('XIRSYS');
  });
});

describe('parseXirsysResponse (kiến trúc §9.5: v.iceServers là object hoặc mảng)', () => {
  it('dạng object { username, credential, urls[] } → một IceServer', () => {
    expect(
      parseXirsysResponse({
        s: 'ok',
        v: { iceServers: { username: 'u', credential: 'c', urls: ['stun:a', 'turn:a'] } },
      }),
    ).toEqual({ iceServers: [{ urls: ['stun:a', 'turn:a'], username: 'u', credential: 'c' }] });
  });

  it('dạng mảng, urls là chuỗi hoặc mảng; mục STUN không có credential', () => {
    expect(
      parseXirsysResponse({
        s: 'ok',
        v: { iceServers: [{ urls: 'stun:a' }, { urls: ['turn:a:3478'], username: 'u', credential: 'c' }] },
      }),
    ).toEqual({ iceServers: [{ urls: ['stun:a'] }, { urls: ['turn:a:3478'], username: 'u', credential: 'c' }] });
  });

  it('s != ok, thiếu iceServers, url sai scheme → XirsysError PARSE', () => {
    for (const bad of [
      { s: 'error', v: 'auth' },
      { s: 'ok', v: {} },
      { s: 'ok', v: { iceServers: [{ urls: ['http://a'] }] } },
    ]) {
      expect(() => parseXirsysResponse(bad)).toThrow(XirsysError);
    }
  });
});

describe('calls.service — key user:incall treo (DB §5.4)', () => {
  it('script báo đã dọn key treo → log warn { callId, userId } cho từng mục, lời mời vẫn tạo cuộc gọi', async () => {
    const me = new Types.ObjectId().toHexString();
    const peer = new Types.ObjectId().toHexString();
    const conv = new Types.ObjectId();
    const deadCall = new Types.ObjectId().toHexString();
    const warn = vi.fn();
    const logger = { warn, error: vi.fn(), info: vi.fn() } as unknown as Logger;
    const state = {
      incallOf: vi.fn(() => Promise.resolve(null)),
      invite: vi.fn((a: { callId: string }) =>
        Promise.resolve({
          result: 'CREATED',
          callId: a.callId,
          stale: [
            { userId: me, callId: deadCall },
            { userId: peer, callId: deadCall },
          ],
        }),
      ),
      get: vi.fn(() => Promise.resolve(null)),
    } as unknown as CallStateRepository;
    const svc = createCallsService({
      state,
      history: { insert: vi.fn(() => Promise.resolve()) } as unknown as CallsRepository,
      conversations: {
        assertMember: () => Promise.resolve({ conv: { _id: conv, type: 'DIRECT' } }),
        getOtherMember: () => Promise.resolve(peer),
      },
      users: { isBlockedEitherWay: () => Promise.resolve(false), getPublicMany: () => Promise.resolve(new Map()) },
      messages: { createSystemMessage: () => Promise.resolve() },
      emitter: {} as Emitter,
      logger,
    });
    const res = await svc.invite(
      { userId: me, deviceId: randomUUID(), tabId: randomUUID() },
      {
        conversationId: String(conv),
        callType: 'VOICE',
      },
    );
    expect(res.status).toBe('INITIATED');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith({ callId: deadCall, userId: me }, expect.any(String));
    expect(warn).toHaveBeenCalledWith({ callId: deadCall, userId: peer }, expect.any(String));
  });
});
