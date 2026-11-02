// Unit: call-controller (useCallController) — điều phối PeerSession ↔ socket ↔ call.store (kiến trúc §7(e)–(g), §8.6;
// ui_ux_spec.md §3.5–3.7, §4.3–4.4). Socket, emit, media, PeerSession đều giả.
import { CALL_MAX_ICE_RESTARTS, EVENTS, type CallState, type IceServersResponse } from '@hustalo/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { MediaError, type MediaRequest } from '../../lib/webrtc/media';
import type { PeerSessionDeps } from '../../lib/webrtc/peer-session';
import { useCallStore } from '../../stores/call.store';
import { FakeSocket } from '../../test/fake-socket';
import { createCallController, type CallControllerDeps, type PeerLike } from './call-controller';

const CALL = '6720d1b2c3d4e5f601234701';
const CONV = '6720b1b2c3d4e5f601234501';
const ME = '6720a1b2c3d4e5f601234561';
const BOB = { id: '6720a1b2c3d4e5f601234562', displayName: 'Bob', avatarUrl: null };
const ICE: IceServersResponse = {
  iceServers: [{ urls: ['stun:x'] }],
  iceTransportPolicy: 'all',
  expiresAt: '2099-01-01T00:00:00.000Z',
  source: 'FALLBACK',
};
type Ack = { ok: boolean; data?: unknown; error?: { code: string; message: string } };

const mkTrack = (kind: 'audio' | 'video') => ({
  kind,
  stop: vi.fn(),
  enabled: true,
  getSettings: () => ({ deviceId: `${kind}-1` }),
  readyState: 'live',
  label: `${kind}-label`,
});
const mkStream = (...tracks: ReturnType<typeof mkTrack>[]) =>
  ({
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((x) => x.kind === 'audio'),
    getVideoTracks: () => tracks.filter((x) => x.kind === 'video'),
  }) as unknown as MediaStream;

function state(over: Partial<CallState> = {}): CallState & { eventId: string; occurredAt: string } {
  return {
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    callId: CALL,
    conversationId: CONV,
    status: 'RINGING',
    endReason: null,
    callType: 'VOICE',
    callerId: ME,
    calleeId: BOB.id,
    acceptedDeviceId: null,
    acceptedTabId: null,
    connectedAt: null,
    endedAt: null,
    version: 2,
    ...over,
  };
}

let socket: FakeSocket;
let emit: ReturnType<typeof vi.fn<(event: string, payload: unknown) => Promise<Ack>>>;
let peers: (PeerLike & { deps: PeerSessionDeps })[];
let deps: CallControllerDeps;
let navigate: ReturnType<typeof vi.fn>;
let closeOverlay: ReturnType<typeof vi.fn>;
let toast: ReturnType<typeof vi.fn>;
let devChange: (() => void) | null;
let devices: MediaDeviceInfo[];

const okMedia = (s = mkStream(mkTrack('audio'))) =>
  vi.fn((): MediaRequest => ({
    promise: Promise.resolve({ stream: s, video: false, warning: null }),
    cancel: vi.fn(),
  }));

function setup(over: Partial<CallControllerDeps> = {}) {
  socket = new FakeSocket();
  socket.connected = true;
  emit = vi.fn<(event: string, payload: unknown) => Promise<Ack>>(() => Promise.resolve({ ok: true, data: {} }));
  peers = [];
  navigate = vi.fn();
  closeOverlay = vi.fn();
  toast = vi.fn();
  devChange = null;
  devices = [{ deviceId: 'audio-1', kind: 'audioinput', label: 'Micro tích hợp', groupId: '' } as MediaDeviceInfo];
  deps = {
    socket: socket as unknown as CallControllerDeps['socket'],
    emit,
    requestMedia: okMedia(),
    ice: { get: vi.fn(() => Promise.resolve(ICE)), forRestart: vi.fn(() => Promise.resolve(ICE)) },
    createPeer: (d) => {
      const p = {
        deps: d,
        addLocalStream: vi.fn(),
        createOffer: vi.fn((o?: { iceRestart?: boolean }) =>
          Promise.resolve({
            revision: peers.length && o?.iceRestart ? 2 : 1,
            sdp: o?.iceRestart ? 'offer-r' : 'offer',
          }),
        ),
        handleOffer: vi.fn((rev: number) => Promise.resolve({ revision: rev, sdp: 'answer' })),
        handleAnswer: vi.fn(() => Promise.resolve(true)),
        addRemoteCandidate: vi.fn(() => Promise.resolve()),
        updateIceServers: vi.fn(),
        setMicEnabled: vi.fn(),
        setCamEnabled: vi.fn(),
        replaceAudioTrack: vi.fn(() => Promise.resolve()),
        replaceVideoTrack: vi.fn(() => Promise.resolve()),
        close: vi.fn(),
      };
      peers.push(p);
      return p;
    },
    getUserMedia: vi.fn(() => Promise.resolve(mkStream(mkTrack('audio')))),
    devices: {
      enumerate: () => Promise.resolve(devices),
      onChange: (fn) => {
        devChange = fn;
        return () => {
          devChange = null;
        };
      },
    },
    navigate,
    closeOverlay,
    toast,
    ...over,
  };
  const c = createCallController(deps);
  c.start();
  return c;
}

const sent = (event: string) => emit.mock.calls.filter((x) => x[0] === event).map((x) => x[1]);
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  useCallStore.getState().reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('gọi đi (ui_ux_spec.md §3.6, kiến trúc §7(e))', () => {
  it('chuẩn bị media → call:invite → INITIATED mở /call/:id → call:ringing RINGING → call:accepted tạo PeerSession caller và gửi offer revision 1', async () => {
    const c = setup();
    emit.mockImplementation((ev) =>
      Promise.resolve(
        ev === EVENTS.CALL_INVITE
          ? { ok: true, data: { callId: CALL, status: 'INITIATED', merged: false, callType: 'VOICE' } }
          : { ok: true, data: {} },
      ),
    );
    const p = c.startCall({ conversationId: CONV, callType: 'VOICE', peer: BOB });
    expect(useCallStore.getState().localPhase).toBe('PREPARING_MEDIA');
    await p;
    expect(sent(EVENTS.CALL_INVITE)).toEqual([{ conversationId: CONV, callType: 'VOICE' }]);
    expect(useCallStore.getState().call).toMatchObject({ callId: CALL, status: 'INITIATED', role: 'caller' });
    expect(navigate).toHaveBeenCalledWith(`/call/${CALL}`);
    socket.emit(EVENTS.CALL_RINGING, {
      eventId: 'e1',
      occurredAt: '',
      callId: CALL,
      ringExpiresAt: '2099-01-01T00:00:45.000Z',
    });
    expect(useCallStore.getState().call?.status).toBe('RINGING');
    socket.emit(EVENTS.CALL_ACCEPTED, {
      eventId: 'e2',
      occurredAt: '',
      callId: CALL,
      acceptedDeviceId: 'd',
      acceptedTabId: 't',
    });
    await flush();
    expect(peers).toHaveLength(1);
    expect(peers[0]?.deps.role).toBe('caller');
    expect(peers[0]?.addLocalStream).toHaveBeenCalledWith(expect.anything(), { wantVideo: false });
    expect(sent(EVENTS.CALL_OFFER)).toEqual([{ callId: CALL, revision: 1, sdp: 'offer' }]);
  });

  it('TC-AC-078 TC-CALL-MEDIA-001 không có micro → không gửi call:invite, hiện lỗi "Không tìm thấy micro…"', async () => {
    const c = setup({
      requestMedia: vi.fn(() => ({ promise: Promise.reject(new MediaError('MIC_NOT_FOUND')), cancel: vi.fn() })),
    });
    await c.startCall({ conversationId: CONV, callType: 'VOICE', peer: BOB });
    expect(sent(EVENTS.CALL_INVITE)).toHaveLength(0);
    expect(useCallStore.getState().mediaError).toBe('MIC_NOT_FOUND');
    expect(t.calls.media.MIC_NOT_FOUND).toBe('Không tìm thấy micro. Hãy kết nối micro và thử lại.');
  });

  it('TC-CALL-MEDIA-004 PREPARING_MEDIA quá 3 s → "Đang chờ cấp quyền…"; "Hủy" luôn bấm được, không gửi invite; stream đến muộn bị hủy', async () => {
    const cancel = vi.fn();
    const c = setup({ requestMedia: vi.fn(() => ({ promise: new Promise<never>(() => undefined), cancel })) });
    void c.startCall({ conversationId: CONV, callType: 'VIDEO', peer: BOB });
    await vi.advanceTimersByTimeAsync(3000);
    expect(useCallStore.getState().waitingPermission).toBe(true);
    c.hangup();
    expect(cancel).toHaveBeenCalled();
    expect(closeOverlay).toHaveBeenCalled();
    expect(useCallStore.getState().call).toBeNull();
    expect(sent(EVENTS.CALL_INVITE)).toHaveLength(0);
  });

  it('TC-CALL-MEDIA-002 VIDEO thiếu camera → toast "Không tìm thấy camera, tiếp tục với âm thanh", vẫn gọi VIDEO', async () => {
    const c = setup({
      requestMedia: vi.fn(() => ({
        promise: Promise.resolve({
          stream: mkStream(mkTrack('audio')),
          video: false,
          warning: 'CAMERA_NOT_FOUND' as const,
        }),
        cancel: vi.fn(),
      })),
    });
    emit.mockResolvedValue({ ok: true, data: { callId: CALL, status: 'INITIATED', merged: false, callType: 'VIDEO' } });
    await c.startCall({ conversationId: CONV, callType: 'VIDEO', peer: BOB });
    expect(toast).toHaveBeenCalledWith('warning', 'Không tìm thấy camera, tiếp tục với âm thanh');
    expect(sent(EVENTS.CALL_INVITE)).toEqual([{ conversationId: CONV, callType: 'VIDEO' }]);
    expect(useCallStore.getState().hasLocalVideo).toBe(false);
  });

  it('ACK lỗi call:invite → CallEndedNotice theo bảng §3.6; stop media', async () => {
    for (const [code, text] of [
      ['CALL_BUSY', 'Người nhận đang bận'],
      ['USER_BLOCKED', 'Không thể gọi cho người này'],
      ['RATE_LIMITED', 'Bạn thao tác quá nhanh, vui lòng thử lại sau'],
      ['SERVICE_UNAVAILABLE', 'Không thể thực hiện cuộc gọi lúc này'],
      ['VALIDATION_ERROR', 'Cuộc gọi nhóm chưa được hỗ trợ'],
      ['CALL_INVALID_STATE', 'Bạn đang trong một cuộc gọi khác'],
    ] as const) {
      useCallStore.getState().reset();
      const a = mkTrack('audio');
      const c = setup({ requestMedia: okMedia(mkStream(a)) });
      emit.mockResolvedValue({ ok: false, error: { code, message: '' } });
      await c.startCall({ conversationId: CONV, callType: 'VOICE', peer: BOB });
      expect(useCallStore.getState().ended?.text, code).toBe(text);
      expect(a.stop, code).toHaveBeenCalled();
      c.stop();
    }
  });

  it('TC-CALL-SIG-003 glare: ACK merged=true → chuyển thẳng "Đang kết nối…" với vai trò callee, chờ offer (không tự tạo offer)', async () => {
    const c = setup();
    emit.mockResolvedValue({ ok: true, data: { callId: CALL, status: 'ACCEPTED', merged: true, callType: 'VIDEO' } });
    await c.startCall({ conversationId: CONV, callType: 'VOICE', peer: BOB });
    expect(useCallStore.getState().call).toMatchObject({ role: 'callee', status: 'ACCEPTED', callType: 'VIDEO' });
    expect(peers[0]?.deps.role).toBe('callee');
    expect(sent(EVENTS.CALL_OFFER)).toHaveLength(0);
    socket.emit(EVENTS.CALL_OFFER, { eventId: 'o', occurredAt: '', callId: CALL, revision: 1, sdp: 'remote-offer' });
    await flush();
    expect(sent(EVENTS.CALL_ANSWER)).toEqual([{ callId: CALL, revision: 1, sdp: 'answer' }]);
  });
});

describe('gọi đến (ui_ux_spec.md §3.5)', () => {
  const incoming = {
    eventId: 'i1',
    occurredAt: '',
    callId: CALL,
    conversationId: CONV,
    callType: 'VIDEO',
    caller: { ...BOB, username: 'bob' },
    ringExpiresAt: '2099-01-01T00:00:45.000Z',
  };

  it('call:incoming → ACK { ok: true } ngay và hiện màn hình; Trả lời → media → call:accept → /call/:id, PeerSession callee', async () => {
    const c = setup();
    const ack = vi.fn();
    socket.emit(EVENTS.CALL_INCOMING, incoming, ack);
    expect(ack).toHaveBeenCalledWith({ ok: true });
    expect(useCallStore.getState().incoming).toMatchObject({ callId: CALL, callType: 'VIDEO' });
    emit.mockResolvedValue({ ok: true, data: { callId: CALL, status: 'ACCEPTED' } });
    await c.answer({ audioOnly: false });
    expect(sent(EVENTS.CALL_ACCEPT)).toEqual([{ callId: CALL }]);
    expect(navigate).toHaveBeenCalledWith(`/call/${CALL}`);
    expect(useCallStore.getState().incoming).toBeNull();
    expect(peers[0]?.deps.role).toBe('callee');
  });

  it('"Trả lời bằng âm thanh" → requestMedia audioOnly', async () => {
    const requestMedia = okMedia();
    const c = setup({ requestMedia });
    socket.emit(EVENTS.CALL_INCOMING, incoming, vi.fn());
    emit.mockResolvedValue({ ok: true, data: { callId: CALL, status: 'ACCEPTED' } });
    await c.answer({ audioOnly: true });
    expect(requestMedia).toHaveBeenCalledWith('VIDEO', { audioOnly: true });
  });

  it('TC-AC-080 TC-CALL-MEDIA-003 callee bị từ chối quyền → gửi call:end MEDIA_FAILURE, hiện hướng dẫn cấp quyền, không accept', async () => {
    const c = setup({
      requestMedia: vi.fn(() => ({ promise: Promise.reject(new MediaError('PERMISSION_DENIED')), cancel: vi.fn() })),
    });
    socket.emit(EVENTS.CALL_INCOMING, incoming, vi.fn());
    await c.answer({ audioOnly: false });
    expect(sent(EVENTS.CALL_ACCEPT)).toHaveLength(0);
    expect(sent(EVENTS.CALL_END)).toEqual([{ callId: CALL, reason: 'MEDIA_FAILURE' }]);
    expect(useCallStore.getState().mediaError).toBe('PERMISSION_DENIED');
  });

  it('TC-CALL-SIG-016 trả lời ở thiết bị khác: call:answered-elsewhere hoặc ACK CALL_ALREADY_ANSWERED → đóng + toast', async () => {
    const c = setup();
    socket.emit(EVENTS.CALL_INCOMING, incoming, vi.fn());
    socket.emit(EVENTS.CALL_ANSWERED_ELSEWHERE, {
      eventId: 'x',
      occurredAt: '',
      callId: CALL,
      reason: 'ANSWERED_ELSEWHERE',
    });
    expect(useCallStore.getState().incoming).toBeNull();
    expect(toast).toHaveBeenCalledWith('call', 'Đã trả lời trên thiết bị khác');
    toast.mockClear();
    socket.emit(EVENTS.CALL_INCOMING, { ...incoming, eventId: 'i2' }, vi.fn());
    const a = mkTrack('audio');
    c.stop();
    const c2 = setup({ requestMedia: okMedia(mkStream(a)) });
    socket.emit(EVENTS.CALL_INCOMING, { ...incoming, eventId: 'i3' }, vi.fn());
    emit.mockResolvedValue({ ok: false, error: { code: 'CALL_ALREADY_ANSWERED', message: '' } });
    await c2.answer({ audioOnly: false });
    expect(toast).toHaveBeenCalledWith('call', 'Đã trả lời trên thiết bị khác');
    expect(a.stop).toHaveBeenCalled();
  });

  it('TC-CALL-SIG-006 accept quá muộn (CALL_TIMEOUT / CALL_INVALID_STATE) → đóng, toast "Cuộc gọi đã kết thúc", stop track', async () => {
    for (const code of ['CALL_TIMEOUT', 'CALL_INVALID_STATE']) {
      useCallStore.getState().reset();
      const a = mkTrack('audio');
      const c = setup({ requestMedia: okMedia(mkStream(a)) });
      socket.emit(EVENTS.CALL_INCOMING, incoming, vi.fn());
      emit.mockResolvedValue({ ok: false, error: { code, message: '' } });
      await c.answer({ audioOnly: false });
      expect(toast, code).toHaveBeenCalledWith('call', 'Cuộc gọi đã kết thúc');
      expect(a.stop).toHaveBeenCalled();
      expect(useCallStore.getState().incoming).toBeNull();
      c.stop();
    }
  });

  it('Từ chối: CALL_INVALID_STATE (đã hủy/nhỡ trong lúc bấm) → vẫn đóng, không toast (spec 68ff6c4)', async () => {
    const c = setup();
    socket.emit(EVENTS.CALL_INCOMING, incoming, vi.fn());
    emit.mockResolvedValue({ ok: false, error: { code: 'CALL_INVALID_STATE', message: '' } });
    await c.reject();
    expect(sent(EVENTS.CALL_REJECT)).toEqual([{ callId: CALL }]);
    expect(useCallStore.getState().incoming).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it('call:state MISSED / CANCELLED của cuộc gọi đến → đóng + toast "Cuộc gọi nhỡ từ Bob"', () => {
    setup();
    socket.emit(EVENTS.CALL_INCOMING, incoming, vi.fn());
    socket.emit(
      EVENTS.CALL_STATE,
      state({ status: 'MISSED', endReason: 'TIMEOUT', callerId: BOB.id, calleeId: ME, version: 3 }),
    );
    expect(useCallStore.getState().incoming).toBeNull();
    expect(toast).toHaveBeenCalledWith('call', 'Cuộc gọi nhỡ từ Bob');
  });

  it('call:busy → toast "{tên} vừa gọi cho bạn", không đụng cuộc gọi hiện tại', () => {
    setup();
    socket.emit(EVENTS.CALL_BUSY, {
      eventId: 'b',
      occurredAt: '',
      callId: 'x',
      caller: { ...BOB, username: 'bob' },
      callType: 'VOICE',
    });
    expect(toast).toHaveBeenCalledWith('call', 'Bob vừa gọi cho bạn');
  });
});

describe('trong cuộc gọi (kiến trúc §8.4, §8.6)', () => {
  async function connected(c: ReturnType<typeof setup>) {
    emit.mockImplementation((ev) =>
      Promise.resolve(
        ev === EVENTS.CALL_INVITE
          ? { ok: true, data: { callId: CALL, status: 'INITIATED', merged: false, callType: 'VOICE' } }
          : { ok: true, data: {} },
      ),
    );
    await c.startCall({ conversationId: CONV, callType: 'VOICE', peer: BOB });
    socket.emit(EVENTS.CALL_ACCEPTED, {
      eventId: 'a',
      occurredAt: '',
      callId: CALL,
      acceptedDeviceId: 'd',
      acceptedTabId: 't',
    });
    await flush();
    socket.emit(EVENTS.CALL_STATE, state({ status: 'CONNECTED', version: 5, connectedAt: new Date().toISOString() }));
    return peers[0] as PeerLike & { deps: PeerSessionDeps };
  }

  it('call:state version cũ hơn bị bỏ; terminal → pc.close, CallEndedNotice §8.6 rồi đóng overlay sau thời gian quy định', async () => {
    const c = setup();
    const peer = await connected(c);
    socket.emit(EVENTS.CALL_STATE, state({ status: 'RECONNECTING', version: 4 }));
    expect(useCallStore.getState().call?.status).toBe('CONNECTED');
    socket.emit(EVENTS.CALL_STATE, state({ status: 'ENDED', endReason: 'NETWORK_FAILURE', version: 7 }));
    expect(peer.close).toHaveBeenCalled();
    expect(useCallStore.getState().ended).toEqual({
      text: 'Cuộc gọi bị gián đoạn do mất kết nối',
      retry: true,
      closeAfterMs: 4000,
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(closeOverlay).toHaveBeenCalled();
    expect(useCallStore.getState().call).toBeNull();
  });

  it('ánh xạ chuỗi kết thúc §8.6 theo status/endReason/vai trò', async () => {
    const cases: [Partial<CallState>, string, number][] = [
      [{ status: 'ENDED', endReason: 'HANGUP' }, 'Cuộc gọi đã kết thúc', 2000],
      [{ status: 'FAILED', endReason: 'MEDIA_FAILURE' }, 'Cuộc gọi kết thúc do lỗi thiết bị âm thanh/hình ảnh', 4000],
      [{ status: 'ENDED', endReason: 'PEER_DISCONNECTED' }, 'Người kia đã mất kết nối', 4000],
      [{ status: 'FAILED', endReason: 'SERVER_RESTART' }, 'Cuộc gọi đã kết thúc do sự cố máy chủ', 4000],
      [{ status: 'ENDED', endReason: 'LOGOUT' }, 'Cuộc gọi đã kết thúc', 2000],
      [{ status: 'REJECTED', endReason: 'REJECTED' }, 'Người nhận đã từ chối cuộc gọi', 3000],
      [{ status: 'MISSED', endReason: 'TIMEOUT' }, 'Không có người trả lời', 4000],
    ];
    for (const [s, text, ms] of cases) {
      useCallStore.getState().reset();
      const c = setup();
      await connected(c);
      socket.emit(EVENTS.CALL_STATE, state({ ...s, version: 9 }));
      expect(useCallStore.getState().ended, String(s.endReason)).toMatchObject({ text, closeAfterMs: ms });
      c.stop();
    }
  });

  it('offer/answer/candidate từ bên kia → PeerSession; local candidate/report → call:ice-candidate / call:state', async () => {
    const c = setup();
    const peer = await connected(c);
    socket.emit(EVENTS.CALL_ANSWER, { eventId: 'x', occurredAt: '', callId: CALL, revision: 1, sdp: 'ans' });
    socket.emit(EVENTS.CALL_ICE_CANDIDATE, {
      eventId: 'y',
      occurredAt: '',
      callId: CALL,
      revision: 1,
      candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null },
    });
    await flush();
    expect(peer.handleAnswer).toHaveBeenCalledWith(1, 'ans');
    expect(peer.addRemoteCandidate).toHaveBeenCalledWith(1, expect.objectContaining({ candidate: 'c' }));
    peer.deps.onLocalCandidate(1, { candidate: 'mine', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null });
    peer.deps.onReport('connected');
    expect(sent(EVENTS.CALL_ICE_CANDIDATE)).toEqual([
      {
        callId: CALL,
        revision: 1,
        candidate: { candidate: 'mine', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null },
      },
    ]);
    expect(sent(EVENTS.CALL_STATE)).toContainEqual({ callId: CALL, connectionState: 'connected' });
    // event của cuộc gọi khác bị bỏ (EC-CALL-SIG-010)
    socket.emit(EVENTS.CALL_ANSWER, { eventId: 'z', occurredAt: '', callId: 'other', revision: 1, sdp: 'x' });
    await flush();
    expect(peer.handleAnswer).toHaveBeenCalledTimes(1);
  });

  it(`TC-CALL-NET-005 TC-CALL-NET-010 cần ICE restart: credential mới → setConfiguration → call:ice-restart → offer iceRestart; quá ${CALL_MAX_ICE_RESTARTS} lần → call:end NETWORK_FAILURE`, async () => {
    const c = setup();
    const peer = await connected(c);
    peer.deps.onNeedIceRestart();
    await flush();
    expect(deps.ice.forRestart).toHaveBeenCalled();
    expect(peer.updateIceServers).toHaveBeenCalledWith({ iceServers: ICE.iceServers, iceTransportPolicy: 'all' });
    expect(sent(EVENTS.CALL_ICE_RESTART)).toEqual([{ callId: CALL, attempt: 1 }]);
    expect(peer.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
    peer.deps.onNeedIceRestart();
    await flush();
    expect(sent(EVENTS.CALL_ICE_RESTART)).toHaveLength(2);
    peer.deps.onNeedIceRestart();
    await flush();
    expect(sent(EVENTS.CALL_ICE_RESTART)).toHaveLength(2);
    expect(sent(EVENTS.CALL_END)).toEqual([{ callId: CALL, reason: 'NETWORK_FAILURE' }]);
  });

  it('callee cần restart → chỉ gửi call:ice-restart (caller là bên tạo offer, D-04); caller nhận call:ice-restart → tạo offer iceRestart', async () => {
    const c = setup();
    const peer = await connected(c);
    socket.emit(EVENTS.CALL_ICE_RESTART, { eventId: 'r', occurredAt: '', callId: CALL, attempt: 1 });
    await flush();
    expect(peer.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
    expect(sent(EVENTS.CALL_OFFER).at(-1)).toMatchObject({ callId: CALL, sdp: 'offer-r' });
  });

  it('socket reconnect khi đang gọi → gửi call:state để server hủy deadline PEER (§7(f))', async () => {
    const c = setup();
    const peer = await connected(c);
    peer.deps.onReport('connected');
    emit.mockClear();
    socket.emit('connect');
    expect(sent(EVENTS.CALL_STATE)).toEqual([{ callId: CALL, connectionState: 'connected' }]);
  });

  it('TC-CALL-MEDIA-006 devicechange làm mất micro đang dùng → lấy micro mặc định, replaceTrack, toast "Đã chuyển sang {thiết bị}"', async () => {
    const c = setup();
    const peer = await connected(c);
    devices = [{ deviceId: 'builtin', kind: 'audioinput', label: 'Micro tích hợp', groupId: '' } as MediaDeviceInfo];
    const fresh = mkTrack('audio');
    fresh.getSettings = () => ({ deviceId: 'builtin' });
    vi.mocked(deps.getUserMedia).mockResolvedValueOnce(mkStream(fresh));
    devChange?.();
    await flush();
    expect(peer.replaceAudioTrack).toHaveBeenCalledWith(fresh);
    expect(toast).toHaveBeenCalledWith('success', 'Đã chuyển sang Micro tích hợp');
  });

  it('TC-CALL-MEDIA-007 audio không lấy lại được (onFatalMedia) → call:end MEDIA_FAILURE; video mất → tắt camera', async () => {
    const c = setup();
    const peer = await connected(c);
    peer.deps.onVideoLost();
    expect(useCallStore.getState()).toMatchObject({ camEnabled: false, hasLocalVideo: false });
    peer.deps.onFatalMedia('audio');
    expect(sent(EVENTS.CALL_END)).toEqual([{ callId: CALL, reason: 'MEDIA_FAILURE' }]);
  });

  it('bật/tắt micro, camera; networkQuality poor → store', async () => {
    const c = setup();
    const peer = await connected(c);
    c.toggleMic();
    expect(peer.setMicEnabled).toHaveBeenCalledWith(false);
    expect(useCallStore.getState().micEnabled).toBe(false);
    peer.deps.onQuality('poor');
    expect(useCallStore.getState().networkQuality).toBe('poor');
  });

  it('Kết thúc: CONNECTED → call:end HANGUP; đang đổ chuông → call:cancel', async () => {
    const c = setup();
    await connected(c);
    c.hangup();
    expect(sent(EVENTS.CALL_END)).toEqual([{ callId: CALL, reason: 'HANGUP' }]);
    c.stop();
    useCallStore.getState().reset();
    const c2 = setup();
    emit.mockResolvedValue({ ok: true, data: { callId: CALL, status: 'INITIATED', merged: false, callType: 'VOICE' } });
    await c2.startCall({ conversationId: CONV, callType: 'VOICE', peer: BOB });
    c2.hangup();
    expect(sent(EVENTS.CALL_CANCEL)).toEqual([{ callId: CALL }]);
  });
});

describe('chi tiết trong cuộc gọi (ui_ux_spec.md §3.7, §4.3; PRD FR-CALL-001/002)', () => {
  const inviteOk = () =>
    emit.mockImplementation((ev) =>
      Promise.resolve(
        ev === EVENTS.CALL_INVITE
          ? { ok: true, data: { callId: CALL, status: 'INITIATED', merged: false, callType: 'VIDEO' } }
          : { ok: true, data: {} },
      ),
    );

  it('ACK RATE_LIMITED → khóa nút gọi 60 s (callBlockedUntil); gọi lại trong lúc khóa không xin media', async () => {
    const requestMedia = okMedia();
    const c = setup({ requestMedia });
    emit.mockResolvedValue({ ok: false, error: { code: 'RATE_LIMITED', message: '' } });
    const t0 = Date.now();
    await c.startCall({ conversationId: CONV, callType: 'VOICE', peer: BOB });
    expect(useCallStore.getState().callBlockedUntil).toBe(t0 + 60_000);
    await vi.advanceTimersByTimeAsync(3000); // CallEndedNotice tự đóng
    requestMedia.mockClear();
    await c.startCall({ conversationId: CONV, callType: 'VOICE', peer: BOB });
    expect(requestMedia).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    await c.startCall({ conversationId: CONV, callType: 'VOICE', peer: BOB });
    expect(requestMedia).toHaveBeenCalledTimes(1);
  });

  it('sau khi có media: đếm camera và loa (enumerateDevices) cho nút "Đổi camera" / "Chọn loa"', async () => {
    const c = setup();
    devices = [
      { deviceId: 'a1', kind: 'audioinput', label: 'Micro', groupId: '' },
      { deviceId: 'front', kind: 'videoinput', label: 'Camera trước', groupId: '' },
      { deviceId: 'back', kind: 'videoinput', label: 'Camera sau', groupId: '' },
      { deviceId: 'spk', kind: 'audiooutput', label: 'Loa ngoài', groupId: '' },
    ] as MediaDeviceInfo[];
    inviteOk();
    await c.startCall({ conversationId: CONV, callType: 'VIDEO', peer: BOB });
    await flush();
    expect(useCallStore.getState().cameraCount).toBe(2);
    expect(useCallStore.getState().audioOutputs).toEqual([{ deviceId: 'spk', label: 'Loa ngoài' }]);
  });

  it('"Đổi camera": xin camera facingMode còn lại, replaceTrack video, cập nhật facingMode (mirror chỉ camera trước)', async () => {
    const c = setup({
      requestMedia: vi.fn(() => ({
        promise: Promise.resolve({ stream: mkStream(mkTrack('audio'), mkTrack('video')), video: true, warning: null }),
        cancel: vi.fn(),
      })),
    });
    inviteOk();
    await c.startCall({ conversationId: CONV, callType: 'VIDEO', peer: BOB });
    socket.emit(EVENTS.CALL_ACCEPTED, {
      eventId: 'a',
      occurredAt: '',
      callId: CALL,
      acceptedDeviceId: 'd',
      acceptedTabId: 't',
    });
    await flush();
    const back = mkTrack('video');
    vi.mocked(deps.getUserMedia).mockResolvedValueOnce(mkStream(back));
    expect(useCallStore.getState().facingMode).toBe('user');
    await c.switchCamera();
    expect(deps.getUserMedia).toHaveBeenLastCalledWith({ video: { facingMode: 'environment' } });
    expect(peers[0]?.replaceVideoTrack).toHaveBeenCalledWith(back);
    expect(useCallStore.getState().facingMode).toBe('environment');
  });

  it('"Chọn loa": lưu sinkId để RemoteAudio gọi setSinkId', () => {
    const c = setup();
    c.setSpeaker('spk');
    expect(useCallStore.getState().sinkId).toBe('spk');
  });
});
