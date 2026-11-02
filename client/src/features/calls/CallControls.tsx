// client/src/features/calls/CallControls.tsx — Mic / Camera (chỉ VIDEO có camera) / Kết thúc hoặc Hủy (§3.6, §3.7)
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { vi } from '../../i18n/vi';

function Round(props: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  danger?: boolean;
  caption?: string;
}) {
  return (
    <span className="flex flex-col items-center gap-1 text-xs text-white/80">
      <button
        type="button"
        aria-label={props.label}
        title={props.label}
        {...(props.pressed !== undefined ? { 'aria-pressed': props.pressed } : {})}
        onClick={props.onClick}
        className={`inline-flex items-center justify-center rounded-pill text-white ${
          props.danger ? 'h-16 w-16 bg-danger hover:opacity-90' : 'h-12 w-12 bg-white/15 hover:bg-white/25'
        }`}
      >
        {props.icon}
      </button>
      {props.caption ? <span aria-hidden="true">{props.caption}</span> : null}
    </span>
  );
}

export function CallControls(props: {
  micEnabled: boolean;
  camEnabled: boolean;
  showCamera: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onEnd: () => void;
  endKind: 'cancel' | 'hangup';
  captions?: boolean;
}) {
  const micLabel = props.micEnabled ? vi.calls.micOff : vi.calls.micOn;
  const camLabel = props.camEnabled ? vi.calls.camOff : vi.calls.camOn;
  return (
    <div className="flex items-end justify-center gap-6 pb-[max(16px,var(--safe-bottom))]">
      <Round
        label={micLabel}
        pressed={!props.micEnabled}
        icon={props.micEnabled ? <Mic size={22} aria-hidden="true" /> : <MicOff size={22} aria-hidden="true" />}
        onClick={props.onToggleMic}
        {...(props.captions ? { caption: micLabel } : {})}
      />
      {props.showCamera ? (
        <Round
          label={camLabel}
          pressed={!props.camEnabled}
          icon={props.camEnabled ? <Video size={22} aria-hidden="true" /> : <VideoOff size={22} aria-hidden="true" />}
          onClick={props.onToggleCam}
          {...(props.captions ? { caption: camLabel } : {})}
        />
      ) : null}
      <Round
        danger
        label={props.endKind === 'cancel' ? vi.calls.cancelLabel : vi.calls.hangup}
        icon={<PhoneOff size={26} aria-hidden="true" />}
        onClick={props.onEnd}
        {...(props.captions && props.endKind === 'cancel' ? { caption: vi.calls.cancel } : {})}
      />
    </div>
  );
}
