// client/src/features/calls/InCallScreen.tsx — đang gọi (ui_ux_spec.md §3.7): ACCEPTED/CONNECTING "Đang kết nối…",
// CONNECTED đồng hồ, RECONNECTING lớp mờ "Đang kết nối lại…"; phím M / V bật tắt mic / camera (không khi đang gõ).
import { useEffect } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { vi } from '../../i18n/vi';
import { useCallStore, type ActiveCall } from '../../stores/call.store';
import { AutoplayUnlockButton } from './AutoplayUnlockButton';
import { CallControls } from './CallControls';
import { CallStatusText } from './CallStatusText';
import { CallTopBar } from './CallTopBar';
import { LocalVideo } from './LocalVideo';
import { RemoteAudio } from './RemoteAudio';
import { RemoteVideo } from './RemoteVideo';
import { useCallActions } from './useCallController';

const isTyping = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);

export function InCallScreen({ call }: { call: ActiveCall }) {
  const s = useCallStore();
  const actions = useCallActions();
  const video = call.callType === 'VIDEO';
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

  return (
    <div className="relative flex h-full flex-col">
      <RemoteAudio stream={s.remoteStream} />
      <CallTopBar name={call.peer.displayName} connectedAt={clockFrom} />
      <div className="relative flex flex-1 items-center justify-center">
        {video ? (
          <RemoteVideo stream={s.remoteStream} peer={call.peer} />
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
        {video && s.hasLocalVideo ? (
          <LocalVideo
            stream={s.localStream}
            className="absolute bottom-4 right-4 h-32 w-24 rounded-md shadow-pip md:h-[135px] md:w-[240px]"
          />
        ) : null}
      </div>
      <CallControls
        micEnabled={s.micEnabled}
        camEnabled={s.camEnabled}
        showCamera={video && s.hasLocalVideo}
        onToggleMic={actions.toggleMic}
        onToggleCam={actions.toggleCam}
        onEnd={actions.hangup}
        endKind="hangup"
      />
    </div>
  );
}
