// client/src/features/calls/useCallController.ts — gắn call-controller vào app (kiến trúc §4.1: điều phối
// PeerSession ↔ socket ↔ call.store). RootLayout gọi useCallController() một lần khi đã đăng nhập; component lấy hành
// động qua useCallActions() (test thay bằng setCallControllerForTest).
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { emitWithAck } from '../../lib/socket/emit';
import { socket } from '../../lib/socket/socket';
import { iceServers } from '../../lib/webrtc/ice-servers';
import { requestMedia } from '../../lib/webrtc/media';
import { PeerSession } from '../../lib/webrtc/peer-session';
import { useAuthStore } from '../../stores/auth.store';
import { useCallStore } from '../../stores/call.store';
import { useUiStore } from '../../stores/ui.store';
import { createCallController, type CallController, type CallControllerDeps } from './call-controller';
import { installCallStatsHook } from './call-stats-hook';

export type CallActions = Pick<
  CallController,
  | 'startCall'
  | 'answer'
  | 'reject'
  | 'hangup'
  | 'toggleMic'
  | 'toggleCam'
  | 'dismiss'
  | 'retry'
  | 'callAgain'
  | 'switchCamera'
  | 'setSpeaker'
>;

let current: CallActions | null = null;

const noop: CallActions = {
  startCall: () => Promise.resolve(),
  answer: () => Promise.resolve(),
  reject: () => Promise.resolve(),
  hangup: () => undefined,
  toggleMic: () => undefined,
  toggleCam: () => undefined,
  dismiss: () => undefined,
  retry: () => Promise.resolve(),
  callAgain: () => Promise.resolve(),
  switchCamera: () => Promise.resolve(),
  setSpeaker: () => undefined,
};

export function useCallActions(): CallActions {
  return current ?? noop;
}

export function setCallControllerForTest(c: CallActions | null): void {
  current = c;
}

export function useCallController(): void {
  const navigate = useNavigate();
  const meId = useAuthStore((s) => s.user?.id ?? '');
  useEffect(() => {
    if (!meId) return;
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    const deps: CallControllerDeps = {
      socket: socket as unknown as CallControllerDeps['socket'],
      emit: (event, payload) =>
        (emitWithAck as unknown as (e: string, p: unknown) => Promise<Awaited<ReturnType<CallControllerDeps['emit']>>>)(
          event,
          payload,
        ),
      requestMedia: (callType, opts) => requestMedia(callType, opts),
      ice: iceServers,
      createPeer: (d) => new PeerSession(d),
      getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
      ...(md?.addEventListener
        ? {
            devices: {
              enumerate: () => md.enumerateDevices(),
              onChange: (fn: () => void) => {
                md.addEventListener('devicechange', fn);
                return () => {
                  md.removeEventListener('devicechange', fn);
                };
              },
            },
          }
        : {}),
      navigate: (to) => {
        navigate(to, { state: { backgroundLocation: window.location.pathname } });
      },
      closeOverlay: () => {
        if (window.location.pathname.startsWith('/call/')) navigate(-1);
      },
      toast: (tone, text) => {
        useUiStore.getState().pushToast(tone, text);
      },
      network: {
        isOnline: () => navigator.onLine,
        onOnline: (fn) => {
          window.addEventListener('online', fn);
          return () => {
            window.removeEventListener('online', fn);
          };
        },
      },
    };
    const c = createCallController(deps);
    c.start();
    current = c;
    const uninstallStats = installCallStatsHook(() => c.stats());
    return () => {
      uninstallStats();
      c.stop();
      current = null;
      useCallStore.getState().reset();
    };
  }, [meId, navigate]);
}
