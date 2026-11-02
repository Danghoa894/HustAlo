// client/src/stores/call.store.ts — S.call (kiến trúc §8.4 cuối, ui_ux_spec.md §3.5–3.7): `status` mirror call:state có
// version lớn nhất, `localPhase` (PREPARING_MEDIA trước khi có callId), cờ media, networkQuality, thông báo kết thúc.
// Một tab chỉ có tối đa một cuộc gọi đến (`incoming`) và một cuộc gọi đang diễn ra (`call`).
import type { CallEndReason, CallLocalPhase, CallState, CallStatus, CallType } from '@hustalo/shared';
import { create } from 'zustand';
import type { MediaErrorKind } from '../lib/webrtc/media';
import type { NetworkQuality } from '../lib/webrtc/peer-session';

export interface CallPeer {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface IncomingCall {
  callId: string;
  conversationId: string;
  callType: CallType;
  caller: CallPeer;
  ringExpiresAt: string;
}

export interface ActiveCall {
  callId: string | null; // null khi còn PREPARING_MEDIA
  conversationId: string;
  callType: CallType;
  role: 'caller' | 'callee';
  peer: CallPeer;
  status: CallStatus | null;
  version: number;
  endReason: CallEndReason | null;
  connectedAt: string | null;
  ringExpiresAt: string | null;
}

export interface EndedNotice {
  text: string;
  retry: boolean;
  closeAfterMs: number;
}

interface CallStoreState {
  incoming: IncomingCall | null;
  call: ActiveCall | null;
  localPhase: CallLocalPhase;
  waitingPermission: boolean;
  micEnabled: boolean;
  camEnabled: boolean;
  hasLocalVideo: boolean;
  networkQuality: NetworkQuality;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  mediaError: MediaErrorKind | null;
  ended: EndedNotice | null;
  autoplayBlocked: boolean;
  patch: (p: Partial<Omit<CallStoreState, 'patch' | 'applyState' | 'reset'>>) => void;
  /** call:state cho cuộc gọi đang diễn ra; bỏ bản version cũ hơn (§8.4). Trả true nếu đã áp. */
  applyState: (s: CallState) => boolean;
  reset: () => void;
}

const initial = {
  incoming: null,
  call: null,
  localPhase: 'IDLE' as CallLocalPhase,
  waitingPermission: false,
  micEnabled: true,
  camEnabled: true,
  hasLocalVideo: false,
  networkQuality: 'good' as NetworkQuality,
  localStream: null,
  remoteStream: null,
  mediaError: null,
  ended: null,
  autoplayBlocked: false,
};

export const useCallStore = create<CallStoreState>((set, get) => ({
  ...initial,
  patch: (p) => {
    set(p);
  },
  applyState: (s) => {
    const call = get().call;
    if (!call || call.callId !== s.callId || s.version < call.version) return false;
    set({
      call: {
        ...call,
        status: s.status,
        version: s.version,
        endReason: s.endReason,
        connectedAt: s.connectedAt ?? call.connectedAt,
      },
    });
    return true;
  },
  reset: () => {
    set(initial);
  },
}));
