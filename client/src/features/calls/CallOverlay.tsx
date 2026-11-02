// client/src/features/calls/CallOverlay.tsx — lớp cuộc gọi (z-call, nền call) trên mọi route khi có cuộc gọi đi/đang gọi:
// PREPARING/INITIATED/RINGING phía caller → OutgoingCallScreen; ACCEPTED trở đi → InCallScreen; lỗi media → panel;
// terminal → CallEndedNotice. Route /call/:callId (router.tsx) chỉ giữ URL + nền; lớp này đọc S.call (§2, §3.6, §3.7).
import { useEffect } from 'react';
import { useCallStore, type ActiveCall } from '../../stores/call.store';
import { CallEndedNotice } from './CallEndedNotice';
import { InCallScreen } from './InCallScreen';
import { MediaErrorPanel } from './MediaErrorPanel';
import { OutgoingCallScreen } from './OutgoingCallScreen';
import { useCallActions } from './useCallController';

const isOutgoing = (c: ActiveCall) =>
  c.role === 'caller' && (c.callId === null || c.status === null || c.status === 'INITIATED' || c.status === 'RINGING');

export function CallOverlay() {
  const call = useCallStore((s) => s.call);
  const ended = useCallStore((s) => s.ended);
  const mediaError = useCallStore((s) => s.mediaError);
  const incoming = useCallStore((s) => s.incoming);
  const actions = useCallActions();
  const open = !!call || !!ended;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  let body;
  if (ended) {
    body = (
      <div className="flex h-full items-center justify-center">
        <CallEndedNotice
          notice={ended}
          onCallAgain={() => {
            void actions.callAgain();
          }}
        />
      </div>
    );
  } else if (mediaError && !incoming) {
    body = (
      <div className="flex h-full items-center justify-center px-4">
        <MediaErrorPanel
          kind={mediaError}
          onRetry={() => {
            void actions.retry();
          }}
          onClose={actions.dismiss}
        />
      </div>
    );
  } else if (call && isOutgoing(call)) {
    body = <OutgoingCallScreen call={call} />;
  } else if (call) {
    body = <InCallScreen call={call} />;
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={call?.peer.displayName ?? ''}
      className="fixed inset-0 z-call bg-call"
    >
      {body}
    </div>
  );
}
