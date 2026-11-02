// client/src/lib/webrtc/peer-session.ts — PeerSession: một RTCPeerConnection cho một cuộc gọi (kiến trúc §8.4, §7(e)–(f)).
// - Caller luôn là bên tạo offer (D-04), revision tăng mỗi offer (ICE restart → revision mới); callee chỉ answer.
// - Guard signalingState/revision (EC-CALL-SIG-007); candidate trước remote description qua CandidateQueue.
// - connectionState: 'connected' → báo; 'disconnected' kéo dài ICE_DISCONNECTED_GRACE_MS → báo + yêu cầu ICE restart;
//   'failed' → ngay (EC-CALL-NET-002). Sau close() mọi callback im lặng (EC-CALL-NET-008).
// - networkQuality từ getStats mỗi 2 s: mất gói > 5% hoặc RTT > 400 ms trong 3 mẫu liên tiếp → 'poor'; 3 mẫu tốt → 'good'.
// - Track cục bộ ended → lấy lại 1 lần; audio thất bại → onFatalMedia, video thất bại → onVideoLost (EC-CALL-MEDIA-007).
import { ICE_DISCONNECTED_GRACE_MS, type IceServer } from '@hustalo/shared';
import { CandidateQueue, type IceCandidateInit } from './candidate-queue';

export type ConnectionReport = 'connected' | 'disconnected' | 'failed';
export type NetworkQuality = 'good' | 'poor';

export interface PeerConfig {
  iceServers: IceServer[];
  iceTransportPolicy: 'all' | 'relay';
}

/** IceServer (GET /calls/ice-servers) → RTCConfiguration: bỏ username/credential rỗng (STUN). */
function toRtcConfig(c: PeerConfig): RTCConfiguration {
  return {
    iceServers: c.iceServers.map((s) => ({
      urls: s.urls,
      ...(s.username !== undefined ? { username: s.username } : {}),
      ...(s.credential !== undefined ? { credential: s.credential } : {}),
    })),
    iceTransportPolicy: c.iceTransportPolicy,
  };
}

export interface PeerSessionDeps {
  role: 'caller' | 'callee';
  config: PeerConfig;
  createPeerConnection?: (c: RTCConfiguration) => RTCPeerConnection;
  onLocalCandidate: (revision: number, candidate: IceCandidateInit) => void;
  onReport: (state: ConnectionReport) => void;
  onNeedIceRestart: () => void;
  onRemoteStream: (stream: MediaStream) => void;
  onQuality: (q: NetworkQuality) => void;
  onFatalMedia: (kind: 'audio') => void;
  onVideoLost: () => void;
  reacquire: (kind: 'audio' | 'video') => Promise<MediaStreamTrack>;
}

const STATS_INTERVAL_MS = 2000;
const QUALITY_SAMPLES = 3;
const LOSS_POOR = 0.05;
const RTT_POOR_S = 0.4;

export class PeerSession {
  private readonly pc: RTCPeerConnection;
  private readonly queue = new CandidateQueue();
  private localRevision = 0; // caller: revision offer gần nhất
  private pendingAnswer = 0; // caller: revision đang chờ answer
  private remoteOfferRevision = 0; // callee: revision offer đã xử lý
  private lastReport: ConnectionReport | null = null;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private prevStats: { lost: number; received: number } | null = null;
  private bad = 0;
  private good = 0;
  private quality: NetworkQuality = 'good';
  private closed = false;
  private local: MediaStream | null = null;
  /** Sender theo loại: camera tắt thì sender.track = null nên không tìm lại được qua getSenders(). */
  private readonly senders: Partial<Record<'audio' | 'video', RTCRtpSender>> = {};
  private videoTrack: MediaStreamTrack | null = null;

  constructor(private readonly deps: PeerSessionDeps) {
    const create = deps.createPeerConnection ?? ((c: RTCConfiguration) => new RTCPeerConnection(c));
    this.pc = create(toRtcConfig(deps.config));
    this.pc.onicecandidate = (e) => {
      if (this.closed) return;
      const revision = deps.role === 'caller' ? this.localRevision : this.remoteOfferRevision;
      const c = e.candidate?.toJSON();
      deps.onLocalCandidate(revision, {
        candidate: c?.candidate ?? '',
        sdpMid: c?.sdpMid ?? null,
        sdpMLineIndex: c?.sdpMLineIndex ?? null,
        usernameFragment: c?.usernameFragment ?? null,
      });
    };
    this.pc.ontrack = (e) => {
      if (this.closed) return;
      const stream = e.streams[0];
      if (stream) deps.onRemoteStream(stream);
    };
    const onState = () => {
      this.handleState();
    };
    this.pc.onconnectionstatechange = onState;
    this.pc.oniceconnectionstatechange = onState; // dự phòng cho trình duyệt thiếu connectionState
  }

  /** Gắn media cục bộ; VIDEO không có camera → nhận video một chiều (recvonly, EC-CALL-MEDIA-002). */
  addLocalStream(stream: MediaStream, opts: { wantVideo: boolean }): void {
    this.local = stream;
    for (const t of stream.getTracks()) {
      const kind = t.kind === 'audio' ? 'audio' : 'video';
      this.senders[kind] = this.pc.addTrack(t, stream);
      if (kind === 'video') this.videoTrack = t;
      this.watchTrack(t);
    }
    if (opts.wantVideo && stream.getVideoTracks().length === 0) {
      this.pc.addTransceiver('video', { direction: 'recvonly' });
    }
  }

  async createOffer(opts: { iceRestart?: boolean } = {}): Promise<{ revision: number; sdp: string }> {
    if (this.deps.role !== 'caller') throw new Error('callee không tạo offer (D-04)');
    this.localRevision += 1;
    const offer = await this.pc.createOffer(opts.iceRestart ? { iceRestart: true } : undefined);
    await this.pc.setLocalDescription(offer);
    this.pendingAnswer = this.localRevision;
    return { revision: this.localRevision, sdp: offer.sdp ?? '' };
  }

  /** Callee: revision cũ hơn hoặc bằng đã xử lý → null (bỏ). Offer mới khi have-remote-offer → rollback ngầm. */
  async handleOffer(revision: number, sdp: string): Promise<{ revision: number; sdp: string } | null> {
    if (this.closed || this.deps.role !== 'callee' || revision <= this.remoteOfferRevision) return null;
    const st = this.pc.signalingState;
    if (st !== 'stable' && st !== 'have-remote-offer') return null;
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    this.remoteOfferRevision = revision;
    this.queue.remoteDescriptionSet(revision);
    await this.flushCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return { revision, sdp: answer.sdp ?? '' };
  }

  /** Caller: chỉ nhận khi have-local-offer và đúng revision đang chờ (không log SDP). */
  async handleAnswer(revision: number, sdp: string): Promise<boolean> {
    if (this.closed || this.deps.role !== 'caller') return false;
    if (this.pc.signalingState !== 'have-local-offer' || revision !== this.pendingAnswer) return false;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    this.queue.remoteDescriptionSet(revision);
    await this.flushCandidates();
    return true;
  }

  async addRemoteCandidate(revision: number, candidate: IceCandidateInit): Promise<void> {
    if (this.closed) return;
    if (this.queue.offer(revision, candidate) === 'add') await this.addCandidate(candidate);
  }

  /** Credential TURN mới trước ICE restart (EC-CALL-NET-005). */
  updateIceServers(config: PeerConfig): void {
    if (this.closed) return;
    this.pc.setConfiguration(toRtcConfig(config));
  }

  setMicEnabled(on: boolean): void {
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = on;
  }

  /**
   * Tắt camera = ngừng gửi (replaceTrack(null)) chứ không chỉ track.enabled: bên kia nhận 'mute' và hiện avatar
   * (AC-071 ≤ 2 s); bật lại gửi lại track cũ.
   */
  async setCamEnabled(on: boolean): Promise<void> {
    const track = this.videoTrack;
    if (!track) return;
    track.enabled = on;
    await this.senders.video?.replaceTrack(on ? track : null);
  }

  /** Đổi camera trước/sau (facingMode, FR-CALL-002). */
  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    await this.replace('video', track);
  }

  /** Đổi micro (thiết bị cũ bị rút, EC-CALL-MEDIA-006). */
  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    await this.replace('audio', track);
  }

  isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.lostTimer) clearTimeout(this.lostTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    for (const t of this.local?.getTracks() ?? []) t.stop();
    this.queue.clear();
    this.pc.close();
  }

  // ---- nội bộ ----
  private async flushCandidates(): Promise<void> {
    for (const c of this.queue.drain()) await this.addCandidate(c);
  }

  private async addCandidate(c: IceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(c);
    } catch {
      // candidate không hợp lệ với description hiện tại → bỏ (không log candidate, §11.3)
    }
  }

  private report(state: ConnectionReport): void {
    this.lastReport = state;
    this.deps.onReport(state);
  }

  private handleState(): void {
    if (this.closed) return;
    // connectionState thiếu ở trình duyệt cũ → suy từ iceConnectionState.
    const state =
      (this.pc.connectionState as RTCPeerConnectionState | undefined) ?? iceToConnection(this.pc.iceConnectionState);
    if (state === 'connected') {
      if (this.lostTimer) clearTimeout(this.lostTimer);
      this.lostTimer = null;
      if (this.lastReport !== 'connected') this.report('connected');
      this.startStats();
    } else if (state === 'disconnected') {
      if (this.lostTimer) return;
      this.lostTimer = setTimeout(() => {
        this.lostTimer = null;
        if (this.closed || this.pc.connectionState !== 'disconnected') return;
        this.report('disconnected');
        this.deps.onNeedIceRestart();
      }, ICE_DISCONNECTED_GRACE_MS);
    } else if (state === 'failed') {
      if (this.lostTimer) clearTimeout(this.lostTimer);
      this.lostTimer = null;
      this.report('failed');
      this.deps.onNeedIceRestart();
    }
  }

  private startStats(): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(() => {
      void this.sampleStats();
    }, STATS_INTERVAL_MS);
  }

  private async sampleStats(): Promise<void> {
    const report = await this.pc.getStats();
    if (this.closed) return;
    let lost = 0;
    let received = 0;
    let rtt = 0;
    report.forEach(
      (s: {
        type?: string;
        packetsLost?: number;
        packetsReceived?: number;
        currentRoundTripTime?: number;
        nominated?: boolean;
        state?: string;
      }) => {
        if (s.type === 'inbound-rtp') {
          lost += s.packetsLost ?? 0;
          received += s.packetsReceived ?? 0;
        } else if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
          rtt = Math.max(rtt, s.currentRoundTripTime ?? 0);
        }
      },
    );
    const prev = this.prevStats;
    this.prevStats = { lost, received };
    if (!prev) return; // mẫu nền
    const dLost = Math.max(0, lost - prev.lost);
    const dTotal = dLost + Math.max(0, received - prev.received);
    const poor = (dTotal > 0 && dLost / dTotal > LOSS_POOR) || rtt > RTT_POOR_S;
    if (poor) {
      this.bad += 1;
      this.good = 0;
      if (this.bad >= QUALITY_SAMPLES && this.quality !== 'poor') {
        this.quality = 'poor';
        this.deps.onQuality('poor');
      }
    } else {
      this.good += 1;
      this.bad = 0;
      if (this.good >= QUALITY_SAMPLES && this.quality === 'poor') {
        this.quality = 'good';
        this.deps.onQuality('good');
      }
    }
  }

  private watchTrack(t: MediaStreamTrack): void {
    t.onended = () => {
      void this.onTrackEnded(t.kind === 'audio' ? 'audio' : 'video');
    };
  }

  private async onTrackEnded(kind: 'audio' | 'video'): Promise<void> {
    if (this.closed) return;
    try {
      await this.replace(kind, await this.deps.reacquire(kind));
    } catch {
      if (this.isClosed()) return; // có thể đã đóng trong lúc chờ reacquire
      if (kind === 'audio') this.deps.onFatalMedia('audio');
      else this.deps.onVideoLost();
    }
  }

  private async replace(kind: 'audio' | 'video', track: MediaStreamTrack): Promise<void> {
    const sender = this.senders[kind] ?? this.pc.getSenders().find((x) => x.track?.kind === kind);
    const old = kind === 'video' ? this.videoTrack : (sender?.track ?? null);
    if (sender) await sender.replaceTrack(track);
    if (kind === 'video') this.videoTrack = track;
    if (this.local && old) {
      this.local.removeTrack(old);
      this.local.addTrack(track);
    }
    old?.stop();
    this.watchTrack(track);
  }
}

function iceToConnection(s: RTCIceConnectionState): RTCPeerConnectionState {
  if (s === 'checking') return 'connecting';
  if (s === 'completed') return 'connected';
  return s;
}
