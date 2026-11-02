// client/src/features/calls/IncomingCallScreen.tsx — lớp cuộc gọi đến trên mọi route (ui_ux_spec.md §3.5): không đổi
// route; Trả lời / Trả lời bằng âm thanh (VIDEO) / Từ chối; Esc không làm gì; tab ẩn → tiêu đề nhấp nháy.
import { Mic, Phone, PhoneOff } from 'lucide-react';
import { useEffect, useId } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { vi } from '../../i18n/vi';
import { serverNow } from '../../lib/time/server-clock';
import { useUiStore } from '../../stores/ui.store';
import { useCallStore } from '../../stores/call.store';
import { AutoplayUnlockButton } from './AutoplayUnlockButton';
import { MediaErrorPanel } from './MediaErrorPanel';
import { useCallActions } from './useCallController';
import { RINGTONE_URL, useRingtone } from './useRingtone';

/** Tiêu đề tab luân phiên "📞 Cuộc gọi đến" / tiêu đề gốc mỗi 1 s khi tab không hiển thị. */
function useTitleFlash(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const original = document.title;
    let on = false;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') {
        document.title = original;
        return;
      }
      on = !on;
      document.title = on ? vi.calls.tabTitle : original;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = original;
    };
  }, [active]);
}

/** Grace sau ringExpiresAt trước khi tự đóng (call:state MISSED bình thường tới trong ≤ 1 s sweep). */
const RING_EXPIRY_GRACE_MS = 2000;

/** Không nhận được call:state (mất mạng): tự đóng theo ringExpiresAt của server (§3.5, server-clock). */
function useRingExpiry(callId: string | undefined, ringExpiresAt: string | undefined, name: string) {
  useEffect(() => {
    if (!callId || !ringExpiresAt) return;
    const wait = Math.max(0, Date.parse(ringExpiresAt) + RING_EXPIRY_GRACE_MS - serverNow());
    const t = setTimeout(() => {
      if (useCallStore.getState().incoming?.callId !== callId) return;
      useCallStore.getState().patch({ incoming: null });
      useUiStore.getState().pushToast('call', vi.calls.missedFrom(name));
    }, wait);
    return () => {
      clearTimeout(t);
    };
  }, [callId, ringExpiresAt, name]);
}

export function IncomingCallScreen() {
  const incoming = useCallStore((s) => s.incoming);
  const preparing = useCallStore((s) => s.localPhase === 'PREPARING_MEDIA');
  const mediaError = useCallStore((s) => s.mediaError);
  const actions = useCallActions();
  const titleId = useId();
  const descId = useId();
  useRingtone(RINGTONE_URL, !!incoming && !preparing && !mediaError);
  useTitleFlash(!!incoming);
  useRingExpiry(incoming?.callId, incoming?.ringExpiresAt, incoming?.caller.displayName ?? '');
  if (!incoming) return null;
  const name = incoming.caller.displayName;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-incoming flex flex-col items-center justify-between bg-call px-4 py-[max(24px,var(--safe-top))] text-white"
    >
      <div className="mt-16 flex flex-col items-center gap-3">
        <span className="rounded-pill motion-safe:animate-ring-pulse">
          <Avatar name={name} size={120} />
        </span>
        <h2 id={titleId} className="text-2xl font-semibold" dir="auto">
          {name}
        </h2>
        <p id={descId} className="text-md text-white/80">
          {incoming.callType === 'VIDEO' ? vi.calls.incomingVideo : vi.calls.incomingVoice}
        </p>
        <AutoplayUnlockButton />
      </div>
      {mediaError ? (
        <MediaErrorPanel kind={mediaError} onClose={actions.dismiss} />
      ) : preparing ? (
        <p className="flex items-center gap-2 text-md">
          <Spinner size={18} />
          {vi.calls.preparing}
        </p>
      ) : (
        <div className="mb-8 flex flex-col items-center gap-6">
          <div className="flex items-center gap-16">
            <span className="flex flex-col items-center gap-1 text-sm">
              <button
                type="button"
                aria-label={vi.calls.rejectLabel(name)}
                onClick={() => {
                  void actions.reject();
                }}
                className="inline-flex h-16 w-16 items-center justify-center rounded-pill bg-danger hover:opacity-90"
              >
                <PhoneOff size={28} aria-hidden="true" />
              </button>
              <span aria-hidden="true">{vi.calls.reject}</span>
            </span>
            <span className="flex flex-col items-center gap-1 text-sm">
              <button
                type="button"
                aria-label={vi.calls.acceptLabel(name)}
                onClick={() => {
                  void actions.answer({ audioOnly: false });
                }}
                className="inline-flex h-16 w-16 items-center justify-center rounded-pill bg-success hover:opacity-90"
              >
                <Phone size={28} aria-hidden="true" />
              </button>
              <span aria-hidden="true">{vi.calls.accept}</span>
            </span>
          </div>
          {incoming.callType === 'VIDEO' ? (
            <button
              type="button"
              aria-label={vi.calls.acceptAudioLabel}
              onClick={() => {
                void actions.answer({ audioOnly: true });
              }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-pill bg-white/15 px-4 hover:bg-white/25"
            >
              <Mic size={18} aria-hidden="true" />
              {vi.calls.acceptAudio}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
