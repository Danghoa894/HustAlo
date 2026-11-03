// Unit: PeerSession (kiến trúc §8.4, §7(e)–(f)) với RTCPeerConnection giả: guard signalingState/revision
// (EC-CALL-SIG-007), xả candidate-queue (EC-CALL-SIG-008), grace 3 s cho 'disconnected' và restart ngay khi 'failed'
// (EC-CALL-NET-002), setConfiguration trước ICE restart (EC-CALL-NET-005), track ended (EC-CALL-MEDIA-007),
// đóng khi terminal (EC-CALL-NET-008), networkQuality (§8.4).
import { ICE_DISCONNECTED_GRACE_MS } from '@hustalo/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerSession, type PeerSessionDeps } from './peer-session';

type Sig = 'stable' | 'have-local-offer' | 'have-remote-offer';

class FakePC {
  signalingState: Sig = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((e: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  offers = 0;
  added: { candidate: string }[] = [];
  remoteSet: RTCSessionDescriptionInit[] = [];
  tracks: MediaStreamTrack[] = [];
  transceivers: { kind: string; init: unknown }[] = [];
  senders: { track: MediaStreamTrack | null; replaceTrack: ReturnType<typeof vi.fn> }[] = [];
  stats: unknown[] = [];
  closed = false;
  setConfiguration = vi.fn();
  constructor(public config: RTCConfiguration) {}
  addTrack(t: MediaStreamTrack) {
    this.tracks.push(t);
    const s: (typeof this.senders)[number] = {
      track: t,
      replaceTrack: vi.fn((nt: MediaStreamTrack | null) => {
        s.track = nt;
        return Promise.resolve();
      }),
    };
    this.senders.push(s);
    return s;
  }
  getSenders() {
    return this.senders;
  }
  addTransceiver(kind: string, init: unknown) {
    this.transceivers.push({ kind, init });
  }
  createOffer(opts?: { iceRestart?: boolean }) {
    this.offers += 1;
    return Promise.resolve({
      type: 'offer' as const,
      sdp: `offer-${this.offers}${opts?.iceRestart ? '-restart' : ''}`,
    });
  }
  createAnswer() {
    return Promise.resolve({ type: 'answer' as const, sdp: 'answer' });
  }
  setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
    return Promise.resolve();
  }
  setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = d;
    this.remoteSet.push(d);
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
    return Promise.resolve();
  }
  addIceCandidate(c: { candidate: string }) {
    this.added.push(c);
    return Promise.resolve();
  }
  getStats() {
    return Promise.resolve(new Map(this.stats.map((s, i) => [String(i), s])));
  }
  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }
  // --- điều khiển từ test
  setConnection(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

const cand = (n: number) => ({
  candidate: `candidate:${n} 1 udp 1 10.0.0.${n} 5000 typ host`,
  sdpMid: '0',
  sdpMLineIndex: 0,
  usernameFragment: null,
});

const mkTrack = (kind: 'audio' | 'video') => {
  const t = { kind, onended: null as null | (() => void), stop: vi.fn(), enabled: true };
  return t as unknown as MediaStreamTrack & { onended: null | (() => void) };
};
const mkStream = (...initial: MediaStreamTrack[]) => {
  let tracks = [...initial];
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    addTrack: (t: MediaStreamTrack) => {
      tracks = [...tracks, t];
    },
    removeTrack: (t: MediaStreamTrack) => {
      tracks = tracks.filter((x) => x !== t);
    },
  } as unknown as MediaStream;
};

let pc: FakePC;
function make(role: 'caller' | 'callee', over: Partial<PeerSessionDeps> = {}) {
  const deps = {
    role,
    config: { iceServers: [{ urls: ['stun:x'] }], iceTransportPolicy: 'all' as const },
    createPeerConnection: (c: RTCConfiguration) => {
      pc = new FakePC(c);
      return pc as unknown as RTCPeerConnection;
    },
    onLocalCandidate: vi.fn(),
    onReport: vi.fn(),
    onNeedIceRestart: vi.fn(),
    onRemoteStream: vi.fn(),
    onQuality: vi.fn(),
    onFatalMedia: vi.fn(),
    onVideoLost: vi.fn(),
    reacquire: vi.fn(),
    ...over,
  } satisfies PeerSessionDeps;
  return { s: new PeerSession(deps), deps };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PeerSession — tạo kết nối', () => {
  it('dùng iceServers + iceTransportPolicy từ GET /calls/ice-servers (relay để test TURN)', () => {
    make('caller', { config: { iceServers: [{ urls: ['turn:t'] }], iceTransportPolicy: 'relay' } });
    expect(pc.config).toEqual({ iceServers: [{ urls: ['turn:t'] }], iceTransportPolicy: 'relay' });
  });

  it('TC-CALL-MEDIA-002 VIDEO không có camera cục bộ → addTransceiver video recvonly', () => {
    const { s } = make('caller');
    s.addLocalStream(mkStream(mkTrack('audio')), { wantVideo: true });
    expect(pc.tracks).toHaveLength(1);
    expect(pc.transceivers).toEqual([{ kind: 'video', init: { direction: 'recvonly' } }]);
  });

  it('caller tạo offer revision tăng dần; callee không bao giờ tự tạo offer (D-04)', async () => {
    const { s } = make('caller');
    expect(await s.createOffer()).toEqual({ revision: 1, sdp: 'offer-1' });
    expect(await s.createOffer({ iceRestart: true })).toEqual({ revision: 2, sdp: 'offer-2-restart' });
    const { s: callee } = make('callee');
    await expect(callee.createOffer()).rejects.toThrow();
  });

  it('local candidate gửi kèm revision hiện tại; null (hết candidate) → candidate rỗng', async () => {
    const { s, deps } = make('caller');
    await s.createOffer();
    pc.onicecandidate?.({ candidate: { toJSON: () => cand(1) } as unknown as RTCIceCandidate });
    pc.onicecandidate?.({ candidate: null });
    expect(deps.onLocalCandidate).toHaveBeenNthCalledWith(1, 1, cand(1));
    expect(deps.onLocalCandidate).toHaveBeenNthCalledWith(2, 1, {
      candidate: '',
      sdpMid: null,
      sdpMLineIndex: null,
      usernameFragment: null,
    });
  });
});

describe('PeerSession — signaling guard (EC-CALL-SIG-007)', () => {
  it('TC-CALL-SIG-007 callee: offer khi stable → answer; offer revision mới khi have-remote-offer → xử lý (rollback ngầm); revision ≤ đã xử lý → bỏ', async () => {
    const { s } = make('callee');
    expect(await s.handleOffer(1, 'o1')).toEqual({ revision: 1, sdp: 'answer' });
    expect(await s.handleOffer(1, 'o1-dup')).toBeNull();
    pc.signalingState = 'have-remote-offer'; // offer 2 tới khi chưa answer xong
    expect(await s.handleOffer(2, 'o2')).toEqual({ revision: 2, sdp: 'answer' });
    expect(pc.remoteSet.map((d) => d.sdp)).toEqual(['o1', 'o2']);
  });

  it('TC-CALL-SIG-007 caller: answer chỉ nhận khi have-local-offer và đúng revision đang chờ', async () => {
    const { s } = make('caller');
    await s.createOffer();
    expect(await s.handleAnswer(2, 'a-wrong-rev')).toBe(false);
    expect(await s.handleAnswer(1, 'a1')).toBe(true);
    expect(await s.handleAnswer(1, 'a1-again')).toBe(false); // đã stable
    expect(pc.remoteSet.map((d) => d.sdp)).toEqual(['a1']);
  });

  it('TC-CALL-SIG-008 TC-CALL-SIG-010 candidate trước remote description được xếp hàng rồi xả; candidate revision cũ bị bỏ', async () => {
    const { s } = make('callee');
    await s.addRemoteCandidate(1, cand(1));
    expect(pc.added).toHaveLength(0);
    await s.handleOffer(1, 'o1');
    expect(pc.added.map((c) => c.candidate)).toEqual([cand(1).candidate]);
    await s.handleOffer(2, 'o2');
    await s.addRemoteCandidate(1, cand(2));
    expect(pc.added).toHaveLength(1);
  });
});

describe('PeerSession — trạng thái kết nối (§8.4, EC-CALL-NET-002)', () => {
  it('connected → báo connected một lần mỗi lần chuyển vào', () => {
    const { deps } = make('caller');
    pc.setConnection('connecting');
    pc.setConnection('connected');
    pc.setConnection('connected');
    expect(deps.onReport).toHaveBeenCalledTimes(1);
    expect(deps.onReport).toHaveBeenCalledWith('connected');
  });

  it(`TC-CALL-NET-002 disconnected < ${ICE_DISCONNECTED_GRACE_MS} ms rồi tự hồi phục → không báo, không restart`, () => {
    const { deps } = make('caller');
    pc.setConnection('connected');
    pc.setConnection('disconnected');
    vi.advanceTimersByTime(ICE_DISCONNECTED_GRACE_MS - 100);
    pc.setConnection('connected');
    vi.advanceTimersByTime(ICE_DISCONNECTED_GRACE_MS);
    expect((deps.onReport as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0])).toEqual(['connected']);
    expect(deps.onNeedIceRestart).not.toHaveBeenCalled();
  });

  it('TC-CALL-NET-002 disconnected ≥ 3 s → báo disconnected + yêu cầu ICE restart; failed → ngay lập tức', () => {
    const { deps } = make('caller');
    pc.setConnection('connected');
    pc.setConnection('disconnected');
    vi.advanceTimersByTime(ICE_DISCONNECTED_GRACE_MS);
    expect(deps.onReport).toHaveBeenLastCalledWith('disconnected');
    expect(deps.onNeedIceRestart).toHaveBeenCalledTimes(1);
    pc.setConnection('failed');
    expect(deps.onReport).toHaveBeenLastCalledWith('failed');
    expect(deps.onNeedIceRestart).toHaveBeenCalledTimes(2);
  });

  it('TC-CALL-NET-005 updateIceServers → pc.setConfiguration với credential mới (trước ICE restart)', () => {
    const { s } = make('caller');
    s.updateIceServers({
      iceServers: [{ urls: ['turn:new'], username: 'u2', credential: 'c2' }],
      iceTransportPolicy: 'all',
    });
    expect(pc.setConfiguration).toHaveBeenCalledWith({
      iceServers: [{ urls: ['turn:new'], username: 'u2', credential: 'c2' }],
      iceTransportPolicy: 'all',
    });
  });

  it('TC-CALL-NET-008 close() (call:state terminal) → đóng pc, dừng mọi timer: không báo/restart thêm', () => {
    const { s, deps } = make('caller');
    pc.setConnection('connected');
    pc.setConnection('disconnected');
    s.close();
    vi.advanceTimersByTime(ICE_DISCONNECTED_GRACE_MS * 2);
    pc.setConnection('failed');
    expect(pc.closed).toBe(true);
    expect(deps.onNeedIceRestart).not.toHaveBeenCalled();
    expect((deps.onReport as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0])).toEqual(['connected']);
  });
});

describe('PeerSession — media trong cuộc gọi', () => {
  it('TC-CALL-MEDIA-007 track audio ended → lấy lại 1 lần và replaceTrack; lại lỗi → onFatalMedia (call:end MEDIA_FAILURE)', async () => {
    const a = mkTrack('audio');
    const fresh = mkTrack('audio');
    const reacquire = vi.fn<(k: 'audio' | 'video') => Promise<MediaStreamTrack>>().mockResolvedValueOnce(fresh);
    const { s, deps } = make('caller', { reacquire });
    s.addLocalStream(mkStream(a), { wantVideo: false });
    a.onended?.();
    await vi.runAllTimersAsync();
    expect(pc.senders[0]?.replaceTrack).toHaveBeenCalledWith(fresh);
    reacquire.mockRejectedValueOnce(new Error('mất micro'));
    (fresh as unknown as { onended: () => void }).onended();
    await vi.runAllTimersAsync();
    expect(deps.onFatalMedia).toHaveBeenCalledWith('audio');
  });

  it('TC-CALL-MEDIA-007 track video ended mà lấy lại thất bại → tắt camera (onVideoLost), không kết thúc cuộc gọi', async () => {
    const v = mkTrack('video');
    const reacquire = vi.fn(() => Promise.reject(new Error('mất camera')));
    const { s, deps } = make('caller', { reacquire });
    s.addLocalStream(mkStream(mkTrack('audio'), v), { wantVideo: true });
    v.onended?.();
    await vi.runAllTimersAsync();
    expect(deps.onVideoLost).toHaveBeenCalled();
    expect(deps.onFatalMedia).not.toHaveBeenCalled();
  });

  it('TC-CALL-MEDIA-006 replaceAudioTrack (đổi thiết bị) → sender audio dùng track mới, track cũ stop', async () => {
    const stopA = vi.fn();
    const a = Object.assign(mkTrack('audio'), { stop: stopA });
    const { s } = make('caller');
    s.addLocalStream(mkStream(a), { wantVideo: false });
    const b = mkTrack('audio');
    await s.replaceAudioTrack(b);
    expect(pc.senders[0]?.replaceTrack).toHaveBeenCalledWith(b);
    expect(stopA).toHaveBeenCalled();
  });

  it('remote stream từ ontrack được chuyển ra (RemoteVideo/RemoteAudio)', () => {
    const { deps } = make('callee');
    const remote = mkStream(mkTrack('audio'));
    pc.ontrack?.({ streams: [remote], track: mkTrack('audio') });
    expect(deps.onRemoteStream).toHaveBeenCalledWith(remote);
  });
});

describe('PeerSession — camera (FR-CALL-002, AC-071)', () => {
  it('tắt camera → ngừng gửi (replaceTrack(null)) để bên kia nhận mute và hiện avatar; bật lại → gửi lại đúng track', async () => {
    const v = mkTrack('video');
    const { s } = make('caller');
    s.addLocalStream(mkStream(mkTrack('audio'), v), { wantVideo: true });
    const videoSender = pc.senders.find((x) => x.track === v);
    await s.setCamEnabled(false);
    expect(videoSender?.replaceTrack).toHaveBeenLastCalledWith(null);
    expect(v.enabled).toBe(false);
    await s.setCamEnabled(true);
    expect(videoSender?.replaceTrack).toHaveBeenLastCalledWith(v);
    expect(v.enabled).toBe(true);
  });

  it('đổi camera (facingMode) → sender video dùng track mới, track cũ stop', async () => {
    const stopOld = vi.fn();
    const v = Object.assign(mkTrack('video'), { stop: stopOld });
    const { s } = make('caller');
    s.addLocalStream(mkStream(mkTrack('audio'), v), { wantVideo: true });
    const back = mkTrack('video');
    await s.replaceVideoTrack(back);
    expect(pc.senders[1]?.replaceTrack).toHaveBeenCalledWith(back);
    expect(stopOld).toHaveBeenCalled();
  });
});

describe('PeerSession — statsSnapshot (development_guide.md §6.6, window.__hustaloCallStats)', () => {
  it('trả về mảng RTCStats từ pc.getStats() để page.evaluate tuần tự hóa được', async () => {
    const { s } = make('caller');
    pc.stats = [{ type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 }];
    await expect(s.statsSnapshot()).resolves.toEqual(pc.stats);
  });
});

describe('PeerSession — networkQuality (§8.4: 3 mẫu liên tiếp)', () => {
  const sample = (lost: number, received: number, rtt: number) => [
    { type: 'inbound-rtp', kind: 'audio', packetsLost: lost, packetsReceived: received },
    { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: rtt },
  ];

  it('mất gói > 5% hoặc RTT > 400 ms trong 3 mẫu liên tiếp → poor; 3 mẫu tốt → good', async () => {
    const { deps } = make('caller');
    pc.setConnection('connected');
    let lost = 0;
    let recv = 0;
    const tick = async (dLost: number, dRecv: number, rtt: number) => {
      lost += dLost;
      recv += dRecv;
      pc.stats = sample(lost, recv, rtt);
      await vi.advanceTimersByTimeAsync(2000);
    };
    await tick(0, 100, 0.05); // mẫu nền
    await tick(10, 90, 0.05);
    await tick(0, 100, 0.5);
    expect(deps.onQuality).not.toHaveBeenCalled();
    await tick(10, 90, 0.05);
    expect(deps.onQuality).toHaveBeenLastCalledWith('poor');
    await tick(0, 100, 0.05);
    await tick(0, 100, 0.05);
    await tick(0, 100, 0.05);
    expect(deps.onQuality).toHaveBeenLastCalledWith('good');
  });
});
