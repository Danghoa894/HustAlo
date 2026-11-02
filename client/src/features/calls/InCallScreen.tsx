// client/src/features/calls/InCallScreen.tsx — đang gọi (ui_ux_spec.md §3.7): ACCEPTED/CONNECTING "Đang kết nối…",
// CONNECTED đồng hồ, RECONNECTING lớp mờ "Đang kết nối lại…"; phím M / V; PiP kéo tới 4 góc, double-click đổi chỗ;
// VIDEO trên mobile tự ẩn điều khiển sau 4 s không chạm; wake lock khi VIDEO CONNECTED.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { vi } from '../../i18n/vi';
import { useCallStore, type ActiveCall, type CallPeer } from '../../stores/call.store';
import { AutoplayUnlockButton } from './AutoplayUnlockButton';
import { CallControls } from './CallControls';
import { CallStatusText } from './CallStatusText';
import { CallTopBar } from './CallTopBar';
import { LocalVideo } from './LocalVideo';
import { RemoteAudio } from './RemoteAudio';
import { RemoteVideo } from './RemoteVideo';
import { useCallActions } from './useCallController';

const AUTO_HIDE_MS = 4000;
const MOBILE_QUERY = '(max-width: 767px)';

const isTyping = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNER_CLASS: Record<Corner, string> = {
  tl: 'left-4 top-4',
  tr: 'right-4 top-4',
  bl: 'bottom-4 left-4',
  br: 'bottom-4 right-4',
};

/** PiP: kéo thả tới 4 góc (mặc định dưới phải), double-click / chạm 2 lần đổi chỗ với khung chính. */
function Pip(props: { onSwap: () => void; children: React.ReactNode }) {
  const [corner, setCorner] = useState<Corner>('br');
  const drag = useRef<number | null>(null);
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = e.pointerId;
    // setPointerCapture không có ở môi trường cũ (và jsdom).
    if ('setPointerCapture' in e.currentTarget) e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current !== e.pointerId) return;
    drag.current = null;
    const top = e.clientY < window.innerHeight / 2;
    const left = e.clientX < window.innerWidth / 2;
    setCorner(top ? (left ? 'tl' : 'tr') : left ? 'bl' : 'br');
  };
  return (
    <div
      data-testid="pip"
      data-corner={corner}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onDoubleClick={props.onSwap}
      className={`absolute h-32 w-24 touch-none overflow-hidden rounded-md shadow-pip md:h-[135px] md:w-[240px] ${CORNER_CLASS[corner]}`}
    >
      {props.children}
    </div>
  );
}

/** VIDEO + mobile: ẩn điều khiển sau 4 s không chạm; không ẩn khi focus nằm trong thanh điều khiển (§3.7). */
function useAutoHide(enabled: boolean, barRef: React.RefObject<HTMLDivElement | null>) {
  const [hidden, setHidden] = useState(false);
  const [mobile] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches);
  const active = enabled && mobile;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!active) return;
    const tick = () => {
      if (barRef.current?.contains(document.activeElement)) timer.current = setTimeout(tick, AUTO_HIDE_MS);
      else setHidden(true);
    };
    timer.current = setTimeout(tick, AUTO_HIDE_MS);
  }, [active, barRef]);
  useEffect(() => {
    arm();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [arm]);
  return {
    hidden: active && hidden,
    show: () => {
      setHidden(false);
      arm();
    },
  };
}

/** Wake lock khi VIDEO CONNECTED (nếu hỗ trợ); nhả khi kết thúc hoặc tab ẩn, xin lại khi tab hiện (§3.7). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    // Screen Wake Lock chưa có ở mọi trình duyệt (Firefox cũ) dù kiểu DOM khai báo luôn có.
    const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } })
      .wakeLock;
    if (!active || !wl) return;
    let sentinel: { release(): Promise<void> } | null = null;
    let disposed = false;
    const acquire = () => {
      void wl
        .request('screen')
        .then((s) => {
          if (disposed) void s.release();
          else sentinel = s;
        })
        .catch(() => undefined);
    };
    const free = () => {
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') free();
      else acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      free();
    };
  }, [active]);
}

function Remote(props: { stream: MediaStream | null; peer: CallPeer }) {
  return <RemoteVideo stream={props.stream} peer={props.peer} />;
}

export function InCallScreen({ call }: { call: ActiveCall }) {
  const s = useCallStore();
  const actions = useCallActions();
  const video = call.callType === 'VIDEO';
  const [swapped, setSwapped] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const auto = useAutoHide(video, barRef);
  useWakeLock(video && call.status === 'CONNECTED');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(document.activeElement)) return;
      if (e.key === 'm' || e.key === 'M') actions.toggleMic();
      else if (video && (e.key === 'v' || e.key === 'V')) actions.toggleCam();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [actions, video]);

  const connecting = call.status === 'ACCEPTED' || call.status === 'CONNECTING';
  const reconnecting = call.status === 'RECONNECTING';
  const clockFrom = call.status === 'CONNECTED' || reconnecting ? call.connectedAt : null;
  const showPip = video && s.hasLocalVideo;
  const local = <LocalVideo stream={s.localStream} mirror={s.facingMode === 'user'} className="h-full w-full" />;
  const remote = <Remote stream={s.remoteStream} peer={call.peer} />;

  return (
    <div
      data-testid="in-call"
      data-swapped={swapped}
      onPointerDown={auto.show}
      onFocusCapture={auto.show}
      className="relative flex h-full flex-col"
    >
      <RemoteAudio stream={s.remoteStream} sinkId={s.sinkId} />
      <CallTopBar name={call.peer.displayName} connectedAt={clockFrom} />
      <div className="relative flex flex-1 items-center justify-center">
        {video ? (
          showPip && swapped ? (
            local
          ) : (
            remote
          )
        ) : (
          <div className="flex flex-col items-center gap-3 text-white">
            <Avatar name={call.peer.displayName} size={120} />
            <h2 className="text-2xl font-semibold" dir="auto">
              {call.peer.displayName}
            </h2>
          </div>
        )}
        {connecting ? (
          <div className="absolute inset-x-0 top-1/2 flex justify-center">
            <CallStatusText text={vi.calls.connecting} />
          </div>
        ) : null}
        {reconnecting ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50">
            <Spinner size={24} />
            <CallStatusText text={vi.calls.reconnecting} />
          </div>
        ) : null}
        <div className="absolute bottom-4 flex justify-center">
          <AutoplayUnlockButton />
        </div>
        {showPip ? (
          <Pip
            onSwap={() => {
              setSwapped((v) => !v);
            }}
          >
            {swapped ? remote : local}
          </Pip>
        ) : null}
      </div>
      <div
        ref={barRef}
        data-testid="call-controls"
        data-hidden={auto.hidden}
        className={`transition-opacity ${auto.hidden ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        <CallControls
          micEnabled={s.micEnabled}
          camEnabled={s.camEnabled}
          showCamera={video && s.hasLocalVideo}
          onToggleMic={actions.toggleMic}
          onToggleCam={actions.toggleCam}
          onEnd={actions.hangup}
          endKind="hangup"
          {...(video && s.hasLocalVideo && s.cameraCount >= 2
            ? {
                onSwitchCamera: () => {
                  void actions.switchCamera();
                },
              }
            : {})}
          speakers={s.audioOutputs}
          sinkId={s.sinkId}
          onSpeaker={actions.setSpeaker}
        />
      </div>
    </div>
  );
}
