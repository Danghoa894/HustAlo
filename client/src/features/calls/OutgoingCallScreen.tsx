// client/src/features/calls/OutgoingCallScreen.tsx — gọi đi (ui_ux_spec.md §3.6): PREPARING_MEDIA → "Đang chuẩn bị…"
// (3 s → "Đang chờ cấp quyền…"), INITIATED "Đang gọi…", RINGING "Đang đổ chuông…" + ringback; "Hủy" luôn bấm được.
import { Avatar } from '../../components/ui/Avatar';
import { vi } from '../../i18n/vi';
import { useCallStore, type ActiveCall } from '../../stores/call.store';
import { CallControls } from './CallControls';
import { CallStatusText } from './CallStatusText';
import { LocalVideo } from './LocalVideo';
import { useCallActions } from './useCallController';
import { RINGBACK_URL, useRingtone } from './useRingtone';

export function OutgoingCallScreen({ call }: { call: ActiveCall }) {
  const s = useCallStore();
  const actions = useCallActions();
  useRingtone(RINGBACK_URL, call.status === 'RINGING');
  const text =
    s.localPhase === 'PREPARING_MEDIA'
      ? s.waitingPermission
        ? vi.calls.waitingPermission
        : vi.calls.preparing
      : call.status === 'RINGING'
        ? vi.calls.ringing
        : vi.calls.calling;
  const showVideo = call.callType === 'VIDEO' && s.hasLocalVideo;
  return (
    <div className="relative flex h-full flex-col">
      {showVideo ? (
        <LocalVideo
          stream={s.localStream}
          mirror={s.facingMode === 'user'}
          className="absolute inset-0 h-full w-full"
        />
      ) : null}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-3">
        {showVideo ? null : <Avatar name={call.peer.displayName} size={120} />}
        <h2 className="text-2xl font-semibold text-white" dir="auto">
          {call.peer.displayName}
        </h2>
        <CallStatusText text={text} />
      </div>
      <div className="relative">
        <CallControls
          captions
          micEnabled={s.micEnabled}
          camEnabled={s.camEnabled}
          showCamera={call.callType === 'VIDEO' && s.hasLocalVideo}
          onToggleMic={actions.toggleMic}
          onToggleCam={actions.toggleCam}
          onEnd={actions.hangup}
          endKind="cancel"
        />
      </div>
    </div>
  );
}
