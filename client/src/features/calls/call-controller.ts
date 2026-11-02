// client/src/features/calls/call-controller.ts — lõi của useCallController: điều phối PeerSession ↔ socket ↔ call.store
// (kiến trúc §7(e)–(g), §8.4–8.6; ui_ux_spec.md §3.5–3.7, §4.3–4.4). Không phụ thuộc React để test bằng socket giả.
// - Gọi đi: PREPARING_MEDIA (3 s → "Đang chờ cấp quyền…") → call:invite → INITIATED → call:ringing → call:accepted →
//   PeerSession caller tạo offer (D-04). Glare (ACK merged) → vai trò callee, chờ offer.
// - Gọi đến: ACK call:incoming ngay; Trả lời → media trước rồi call:accept; lỗi media → call:end MEDIA_FAILURE.
// - call:state version lớn nhất thắng; terminal → đóng pc, stop track, CallEndedNotice theo §8.6 rồi đóng overlay.
// - Mất kết nối: ICE restart ≤ CALL_MAX_ICE_RESTARTS (credential mới trước mỗi lần), hết lượt → call:end NETWORK_FAILURE.
import { CALL_MAX_ICE_RESTARTS, CALL_TERMINAL_STATUSES, EVENTS } from '@hustalo/shared';
import type { CallEndReason, CallState, CallStatus, CallType, IceServersResponse, UserPublic } from '@hustalo/shared';
import { vi } from '../../i18n/vi';
import type { IceCandidateInit } from '../../lib/webrtc/candidate-queue';
import { MediaError, isAudioDeviceGone, stopStream, type MediaRequest } from '../../lib/webrtc/media';
import type { ConnectionReport, PeerSession, PeerSessionDeps } from '../../lib/webrtc/peer-session';
import { useCallStore, type ActiveCall, type CallPeer, type EndedNotice } from '../../stores/call.store';
import type { ToastTone } from '../../stores/ui.store';

export type PeerLike = Pick<
  PeerSession,
  | 'addLocalStream'
  | 'createOffer'
  | 'handleOffer'
  | 'handleAnswer'
  | 'addRemoteCandidate'
  | 'updateIceServers'
  | 'setMicEnabled'
  | 'setCamEnabled'
  | 'replaceAudioTrack'
  | 'close'
>;

type Ack = { ok: boolean; data?: unknown; error?: { code: string; message: string } };
type Listener = (...args: never[]) => void;

export interface CallControllerDeps {
  socket: { on(event: string, fn: Listener): unknown; off(event: string, fn: Listener): unknown; connected: boolean };
  emit: (event: string, payload: unknown) => Promise<Ack>;
  requestMedia: (callType: CallType, opts: { audioOnly?: boolean }) => MediaRequest;
  ice: { get: () => Promise<IceServersResponse>; forRestart: () => Promise<IceServersResponse> };
  createPeer: (deps: PeerSessionDeps) => PeerLike;
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  devices?: { enumerate(): Promise<MediaDeviceInfo[]>; onChange(fn: () => void): () => void };
  navigate: (to: string) => void;
  closeOverlay: () => void;
  toast: (tone: ToastTone, text: string) => void;
}

const PERMISSION_HINT_MS = 3000;
const TERMINAL: readonly CallStatus[] = CALL_TERMINAL_STATUSES;

/** CallEndedNotice theo kiến trúc §8.6 + ui_ux_spec.md §4.3; null = đóng ngay không thông báo. */
export function endedNotice(
  status: CallStatus,
  reason: CallEndReason | null,
  role: 'caller' | 'callee',
): EndedNotice | null {
  const e = vi.calls.ended;
  if (reason === 'LOGOUT') return { text: e.HANGUP, retry: false, closeAfterMs: 2000 };
  if (status === 'REJECTED') return role === 'caller' ? { text: e.REJECTED, retry: false, closeAfterMs: 3000 } : null;
  if (status === 'MISSED') return role === 'caller' ? { text: e.MISSED, retry: true, closeAfterMs: 4000 } : null;
  if (status === 'BUSY') return { text: e.BUSY, retry: false, closeAfterMs: 3000 };
  if (status === 'CANCELLED') {
    // Caller tự hủy → đóng luôn; caller mất kết nối trước khi được trả lời → kết thúc ngắn.
    return role === 'caller' && reason === 'PEER_DISCONNECTED'
      ? { text: e.HANGUP, retry: false, closeAfterMs: 2000 }
      : null;
  }
  switch (reason) {
    case 'NETWORK_FAILURE':
      return { text: e.NETWORK_FAILURE, retry: true, closeAfterMs: 4000 };
    case 'MEDIA_FAILURE':
      return { text: e.MEDIA_FAILURE, retry: false, closeAfterMs: 4000 };
    case 'PEER_DISCONNECTED':
      return { text: e.PEER_DISCONNECTED, retry: true, closeAfterMs: 4000 };
    case 'SERVER_RESTART':
      return { text: e.SERVER_RESTART, retry: true, closeAfterMs: 4000 };
    default:
      return { text: e.HANGUP, retry: false, closeAfterMs: 2000 };
  }
}

/** ui_ux_spec.md §3.6: ACK lỗi call:invite → chuỗi CallEndedNotice. */
function inviteErrorText(code: string): string {
  if (code === 'CALL_BUSY') return vi.calls.ended.BUSY;
  const map = vi.calls.inviteError as Record<string, string>;
  return map[code] ?? vi.calls.inviteError.SERVICE_UNAVAILABLE;
}

const toPeer = (u: Pick<UserPublic, 'id' | 'displayName' | 'avatarUrl'>): CallPeer => ({
  id: u.id,
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
});

export function createCallController(deps: CallControllerDeps) {
  const store = () => useCallStore.getState();
  let media: MediaRequest | null = null;
  let stream: MediaStream | null = null;
  let audioTrack: MediaStreamTrack | null = null;
  let peer: PeerLike | null = null;
  let lastReport: ConnectionReport | null = null;
  let iceAttempts = 0;
  let permTimer: ReturnType<typeof setTimeout> | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let stopDevices: (() => void) | null = null;

  const callId = () => store().call?.callId ?? null;
  const isMine = (id: string) => callId() === id;

  function clearPermTimer() {
    if (permTimer) clearTimeout(permTimer);
    permTimer = null;
  }

  function clearTimers() {
    if (permTimer) clearTimeout(permTimer);
    if (endTimer) clearTimeout(endTimer);
    permTimer = null;
    endTimer = null;
  }

  /** Giải phóng media + pc của cuộc gọi hiện tại (EC-CALL-MEDIA-012: stream đến muộn bị hủy). */
  function release() {
    media?.cancel();
    media = null;
    peer?.close();
    peer = null;
    stopStream(stream);
    stream = null;
    audioTrack = null;
    stopDevices?.();
    stopDevices = null;
    lastReport = null;
    iceAttempts = 0;
  }

  function closeNow() {
    clearTimers();
    release();
    store().patch({
      call: null,
      ended: null,
      localPhase: 'IDLE',
      waitingPermission: false,
      localStream: null,
      remoteStream: null,
      networkQuality: 'good',
      mediaError: null,
    });
    deps.closeOverlay();
  }

  function showEnded(notice: EndedNotice | null) {
    clearTimers();
    release();
    if (!notice) {
      closeNow();
      return;
    }
    store().patch({
      ended: notice,
      localPhase: 'IDLE',
      waitingPermission: false,
      localStream: null,
      remoteStream: null,
    });
    endTimer = setTimeout(closeNow, notice.closeAfterMs);
  }

  function adoptStream(acquired: {
    stream: MediaStream;
    video: boolean;
    warning: 'CAMERA_NOT_FOUND' | 'CAMERA_IN_USE' | null;
  }) {
    stream = acquired.stream;
    audioTrack = acquired.stream.getAudioTracks()[0] ?? null;
    store().patch({
      localStream: acquired.stream,
      hasLocalVideo: acquired.video,
      camEnabled: acquired.video,
      micEnabled: true,
    });
    if (acquired.warning) deps.toast('warning', vi.calls.media[acquired.warning]);
    watchDevices();
  }

  /** EC-CALL-MEDIA-006: micro đang dùng biến mất → micro mặc định, replaceTrack, toast. */
  function watchDevices() {
    if (!deps.devices || stopDevices) return;
    const devices = deps.devices;
    stopDevices = devices.onChange(() => {
      void (async () => {
        const list = await devices.enumerate();
        if (!isAudioDeviceGone(audioTrack ?? undefined, list)) return;
        const fresh = (await deps.getUserMedia({ audio: true })).getAudioTracks()[0];
        if (!fresh) return;
        await peer?.replaceAudioTrack(fresh);
        audioTrack = fresh;
        const id = fresh.getSettings().deviceId;
        const label = list.find((d) => d.kind === 'audioinput' && d.deviceId === id)?.label || fresh.label;
        deps.toast('success', vi.calls.deviceSwitched(label));
      })().catch(() => undefined);
    });
  }

  async function createSession(role: 'caller' | 'callee'): Promise<PeerLike | null> {
    const call = store().call;
    if (!call?.callId || !stream) return null;
    const id = call.callId;
    const ice = await deps.ice.get();
    const session = deps.createPeer({
      role,
      config: { iceServers: ice.iceServers, iceTransportPolicy: ice.iceTransportPolicy },
      onLocalCandidate: (revision: number, candidate: IceCandidateInit) => {
        void deps.emit(EVENTS.CALL_ICE_CANDIDATE, { callId: id, revision, candidate }).catch(() => undefined);
      },
      onReport: (connectionState) => {
        lastReport = connectionState;
        void deps.emit(EVENTS.CALL_STATE, { callId: id, connectionState }).catch(() => undefined);
      },
      onNeedIceRestart: () => {
        void restartIce();
      },
      onRemoteStream: (remote) => {
        store().patch({ remoteStream: remote });
      },
      onQuality: (q) => {
        store().patch({ networkQuality: q });
      },
      onFatalMedia: () => {
        void deps.emit(EVENTS.CALL_END, { callId: id, reason: 'MEDIA_FAILURE' }).catch(() => undefined);
      },
      onVideoLost: () => {
        store().patch({ camEnabled: false, hasLocalVideo: false });
      },
      reacquire: async (kind) => {
        const s = await deps.getUserMedia(kind === 'audio' ? { audio: true } : { video: true });
        const track = s.getTracks()[0];
        if (!track) throw new Error('không có track');
        return track;
      },
    });
    session.addLocalStream(stream, { wantVideo: call.callType === 'VIDEO' });
    peer = session;
    return session;
  }

  async function sendOffer(opts: { iceRestart?: boolean } = {}) {
    const id = callId();
    if (!peer || !id) return;
    const offer = await peer.createOffer(opts);
    await deps.emit(EVENTS.CALL_OFFER, { callId: id, revision: offer.revision, sdp: offer.sdp });
  }

  /** Bên mình phát hiện mất kết nối (PeerSession): ICE restart với credential mới; hết lượt → NETWORK_FAILURE. */
  async function restartIce() {
    const call = store().call;
    if (!peer || !call?.callId) return;
    if (iceAttempts >= CALL_MAX_ICE_RESTARTS) {
      await deps.emit(EVENTS.CALL_END, { callId: call.callId, reason: 'NETWORK_FAILURE' }).catch(() => undefined);
      return;
    }
    const attempt = iceAttempts + 1;
    const ice = await deps.ice.forRestart();
    peer.updateIceServers({ iceServers: ice.iceServers, iceTransportPolicy: ice.iceTransportPolicy });
    const res = await deps.emit(EVENTS.CALL_ICE_RESTART, { callId: call.callId, attempt }).catch(() => null);
    if (!res?.ok) return; // bên kia đã yêu cầu cùng lượt (7(f)) — sẽ nhận relay
    iceAttempts = attempt;
    if (call.role === 'caller') await sendOffer({ iceRestart: true });
  }

  // ---- server → client ----
  const onIncoming = (
    p: { callId: string; conversationId: string; callType: CallType; caller: UserPublic; ringExpiresAt: string },
    ack?: (r: { ok: true }) => void,
  ) => {
    ack?.({ ok: true });
    store().patch({
      incoming: {
        callId: p.callId,
        conversationId: p.conversationId,
        callType: p.callType,
        caller: toPeer(p.caller),
        ringExpiresAt: p.ringExpiresAt,
      },
    });
  };

  const onRinging = (p: { callId: string; ringExpiresAt: string }) => {
    const call = store().call;
    if (!call || call.callId !== p.callId) return;
    store().patch({
      call: { ...call, status: call.status === 'INITIATED' ? 'RINGING' : call.status, ringExpiresAt: p.ringExpiresAt },
    });
  };

  const onAccepted = (p: { callId: string }) => {
    const call = store().call;
    if (!call || call.callId !== p.callId || call.role !== 'caller' || peer) return;
    store().patch({
      call: { ...call, status: TERMINAL.includes(call.status ?? 'INITIATED') ? call.status : 'ACCEPTED' },
    });
    void (async () => {
      await createSession('caller');
      await sendOffer();
    })().catch(() => undefined);
  };

  const onAnsweredElsewhere = (p: { callId: string }) => {
    if (store().incoming?.callId !== p.callId) return;
    media?.cancel();
    store().patch({ incoming: null, localPhase: store().call ? store().localPhase : 'IDLE' });
    deps.toast('call', vi.calls.answeredElsewhere);
  };

  const onBusy = (p: { caller: UserPublic }) => {
    deps.toast('call', vi.calls.busyPing(p.caller.displayName));
  };

  const onState = (s: CallState) => {
    const inc = store().incoming;
    if (inc && inc.callId === s.callId && TERMINAL.includes(s.status)) {
      media?.cancel();
      store().patch({ incoming: null });
      if (s.status === 'MISSED' || s.status === 'CANCELLED')
        deps.toast('call', vi.calls.missedFrom(inc.caller.displayName));
      return;
    }
    const call = store().call;
    if (!call || call.callId !== s.callId) return;
    if (!store().applyState(s)) return;
    if (TERMINAL.includes(s.status)) showEnded(endedNotice(s.status, s.endReason, call.role));
  };

  const onOffer = (p: { callId: string; revision: number; sdp: string }) => {
    if (!isMine(p.callId) || !peer) return;
    const id = p.callId;
    void peer
      .handleOffer(p.revision, p.sdp)
      .then((ans) => (ans ? deps.emit(EVENTS.CALL_ANSWER, { callId: id, revision: ans.revision, sdp: ans.sdp }) : null))
      .catch(() => undefined);
  };

  const onAnswer = (p: { callId: string; revision: number; sdp: string }) => {
    if (!isMine(p.callId) || !peer) return;
    void peer.handleAnswer(p.revision, p.sdp).catch(() => undefined);
  };

  const onCandidate = (p: { callId: string; revision: number; candidate: IceCandidateInit }) => {
    if (!isMine(p.callId) || !peer) return;
    void peer.addRemoteCandidate(p.revision, p.candidate).catch(() => undefined);
  };

  /** Bên kia yêu cầu ICE restart: caller (offerer duy nhất, D-04) tạo offer mới với credential còn hạn. */
  const onRemoteRestart = (p: { callId: string; attempt: number }) => {
    const call = store().call;
    if (!call || call.callId !== p.callId || !peer) return;
    iceAttempts = Math.max(iceAttempts, p.attempt);
    if (call.role !== 'caller') return;
    const session = peer;
    void (async () => {
      const ice = await deps.ice.forRestart();
      session.updateIceServers({ iceServers: ice.iceServers, iceTransportPolicy: ice.iceTransportPolicy });
      await sendOffer({ iceRestart: true });
    })().catch(() => undefined);
  };

  /** Socket reconnect: báo lại trạng thái để server hủy deadline PEER của tab (§7(f)). */
  const onConnect = () => {
    const call = store().call;
    if (!call?.callId || (call.status && TERMINAL.includes(call.status))) return;
    void deps
      .emit(EVENTS.CALL_STATE, { callId: call.callId, connectionState: lastReport ?? 'disconnected' })
      .catch(() => undefined);
  };

  const handlers: [string, Listener][] = [
    [EVENTS.CALL_INCOMING, onIncoming],
    [EVENTS.CALL_RINGING, onRinging],
    [EVENTS.CALL_ACCEPTED, onAccepted],
    [EVENTS.CALL_ANSWERED_ELSEWHERE, onAnsweredElsewhere],
    [EVENTS.CALL_BUSY, onBusy],
    [EVENTS.CALL_STATE, onState],
    [EVENTS.CALL_OFFER, onOffer],
    [EVENTS.CALL_ANSWER, onAnswer],
    [EVENTS.CALL_ICE_CANDIDATE, onCandidate],
    [EVENTS.CALL_ICE_RESTART, onRemoteRestart],
    ['connect', onConnect],
  ];

  return {
    start() {
      for (const [ev, fn] of handlers) deps.socket.on(ev, fn);
    },

    stop() {
      for (const [ev, fn] of handlers) deps.socket.off(ev, fn);
      clearTimers();
      release();
    },

    /** Bấm gọi trong ChatHeader (ui_ux_spec.md §3.6). */
    async startCall(input: { conversationId: string; callType: CallType; peer: CallPeer }): Promise<void> {
      if (store().call) return;
      const call: ActiveCall = {
        callId: null,
        conversationId: input.conversationId,
        callType: input.callType,
        role: 'caller',
        peer: input.peer,
        status: null,
        version: 0,
        endReason: null,
        connectedAt: null,
        ringExpiresAt: null,
      };
      store().patch({ call, localPhase: 'PREPARING_MEDIA', waitingPermission: false, mediaError: null, ended: null });
      permTimer = setTimeout(() => {
        store().patch({ waitingPermission: true });
      }, PERMISSION_HINT_MS);
      const req = deps.requestMedia(input.callType, { audioOnly: false });
      media = req;
      let acquired;
      try {
        acquired = await req.promise;
      } catch (err) {
        clearPermTimer();
        if (media !== req) return; // đã hủy
        const kind = err instanceof MediaError ? err.kind : 'MIC_IN_USE';
        if (kind === 'ABORTED') return;
        media = null;
        store().patch({ mediaError: kind, localPhase: 'IDLE', waitingPermission: false });
        return;
      }
      clearPermTimer();
      if (media !== req || !store().call) {
        stopStream(acquired.stream);
        return;
      }
      store().patch({ waitingPermission: false });
      adoptStream(acquired);

      const res = await deps
        .emit(EVENTS.CALL_INVITE, { conversationId: input.conversationId, callType: input.callType })
        .catch((): Ack => ({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '' } }));
      if (!res.ok) {
        const code = res.error?.code ?? 'SERVICE_UNAVAILABLE';
        showEnded({ text: inviteErrorText(code), retry: false, closeAfterMs: 3000 });
        return;
      }
      const data = res.data as { callId: string; status: CallStatus; merged: boolean; callType: CallType };
      const merged = data.merged;
      store().patch({
        call: {
          ...call,
          callId: data.callId,
          status: data.status,
          callType: data.callType,
          role: merged ? 'callee' : 'caller',
        },
        localPhase: 'IN_CALL',
      });
      // Glare (7(g)): mình là tab đã "trả lời" — chờ offer của caller gốc.
      if (merged) await createSession('callee');
      deps.navigate(`/call/${data.callId}`);
    },

    /** "Trả lời" / "Trả lời bằng âm thanh" (ui_ux_spec.md §3.5). */
    async answer(opts: { audioOnly: boolean }): Promise<void> {
      const inc = store().incoming;
      if (!inc) return;
      store().patch({ localPhase: 'PREPARING_MEDIA', mediaError: null });
      const req = deps.requestMedia(inc.callType, { audioOnly: opts.audioOnly });
      media = req;
      let acquired;
      try {
        acquired = await req.promise;
      } catch (err) {
        const kind = err instanceof MediaError ? err.kind : 'MIC_IN_USE';
        if (kind === 'ABORTED') return;
        media = null;
        await deps.emit(EVENTS.CALL_END, { callId: inc.callId, reason: 'MEDIA_FAILURE' }).catch(() => undefined);
        store().patch({ mediaError: kind, localPhase: 'IDLE' });
        return;
      }
      if (media !== req || store().incoming?.callId !== inc.callId) {
        stopStream(acquired.stream);
        return;
      }
      const res = await deps
        .emit(EVENTS.CALL_ACCEPT, { callId: inc.callId })
        .catch((): Ack => ({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '' } }));
      if (!res.ok) {
        stopStream(acquired.stream);
        media = null;
        store().patch({ incoming: null, localPhase: 'IDLE' });
        deps.toast(
          'call',
          res.error?.code === 'CALL_ALREADY_ANSWERED' ? vi.calls.answeredElsewhere : vi.calls.ended.HANGUP,
        );
        return;
      }
      store().patch({
        incoming: null,
        localPhase: 'IN_CALL',
        call: {
          callId: inc.callId,
          conversationId: inc.conversationId,
          callType: inc.callType,
          role: 'callee',
          peer: inc.caller,
          status: 'ACCEPTED',
          version: 0,
          endReason: null,
          connectedAt: null,
          ringExpiresAt: null,
        },
      });
      adoptStream(acquired);
      await createSession('callee');
      deps.navigate(`/call/${inc.callId}`);
    },

    /** "Từ chối": luôn đóng màn hình; CALL_INVALID_STATE (đã hủy/nhỡ trong lúc bấm) im lặng (spec 68ff6c4). */
    async reject(): Promise<void> {
      const inc = store().incoming;
      if (!inc) return;
      media?.cancel();
      media = null;
      store().patch({ incoming: null, localPhase: store().call ? store().localPhase : 'IDLE', mediaError: null });
      await deps.emit(EVENTS.CALL_REJECT, { callId: inc.callId }).catch(() => undefined);
    },

    /** "Hủy" / "Kết thúc": PREPARING → hủy media + đóng; trước khi được trả lời → call:cancel; sau đó → call:end HANGUP. */
    hangup(): void {
      const call = store().call;
      if (!call) return;
      if (!call.callId) {
        closeNow();
        return;
      }
      const ringing = call.status === null || call.status === 'INITIATED' || call.status === 'RINGING';
      if (call.role === 'caller' && ringing)
        void deps.emit(EVENTS.CALL_CANCEL, { callId: call.callId }).catch(() => undefined);
      else void deps.emit(EVENTS.CALL_END, { callId: call.callId, reason: 'HANGUP' }).catch(() => undefined);
    },

    toggleMic(): void {
      const on = !store().micEnabled;
      peer?.setMicEnabled(on);
      for (const t of stream?.getAudioTracks() ?? []) t.enabled = on;
      store().patch({ micEnabled: on });
    },

    toggleCam(): void {
      if (!store().hasLocalVideo) return;
      const on = !store().camEnabled;
      peer?.setCamEnabled(on);
      for (const t of stream?.getVideoTracks() ?? []) t.enabled = on;
      store().patch({ camEnabled: on });
    },

    /** "Thử lại" ở MediaErrorPanel phía người gọi (micro chưa có / đang bận): xin media lại. */
    async retry(): Promise<void> {
      const call = store().call;
      if (!call || call.callId) return;
      store().patch({ call: null, mediaError: null });
      await this.startCall({ conversationId: call.conversationId, callType: call.callType, peer: call.peer });
    },

    /** "Gọi lại" ở CallEndedNotice. */
    async callAgain(): Promise<void> {
      const call = store().call;
      if (!call) return;
      closeNow();
      await this.startCall({ conversationId: call.conversationId, callType: call.callType, peer: call.peer });
    },

    /** Đóng MediaErrorPanel / CallEndedNotice bằng tay. */
    dismiss(): void {
      if (store().call) closeNow();
      else store().patch({ mediaError: null, localPhase: 'IDLE' });
    },
  };
}

export type CallController = ReturnType<typeof createCallController>;
