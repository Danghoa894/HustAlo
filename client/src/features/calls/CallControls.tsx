// client/src/features/calls/CallControls.tsx — Mic / Camera (VIDEO có camera) / Đổi camera (≥ 2 camera) / Chọn loa (hỗ trợ
// setSinkId) / Kết thúc hoặc Hủy (ui_ux_spec.md §3.6, §3.7).
import { Mic, MicOff, PhoneOff, SwitchCamera, Video, VideoOff, Volume2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { vi } from '../../i18n/vi';

function Round(props: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  danger?: boolean;
  caption?: string;
  extra?: Record<string, string | boolean | undefined>;
}) {
  return (
    <span className="flex flex-col items-center gap-1 text-xs text-white/80">
      <button
        type="button"
        aria-label={props.label}
        title={props.label}
        {...(props.pressed !== undefined ? { 'aria-pressed': props.pressed } : {})}
        {...props.extra}
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

/** "Chọn loa": danh sách audiooutput dạng menuitemradio; Esc / chọn → đóng. */
function SpeakerMenu(props: {
  speakers: { deviceId: string; label: string }[];
  sinkId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
  }, [open]);
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  };
  return (
    <span className="relative">
      <Round
        label={vi.calls.chooseSpeaker}
        icon={<Volume2 size={22} aria-hidden="true" />}
        onClick={() => {
          setOpen((v) => !v);
        }}
        extra={{ 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? menuId : undefined }}
      />
      {open ? (
        <ul
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={vi.calls.chooseSpeaker}
          onKeyDown={onKey}
          className="absolute bottom-14 left-1/2 z-dropdown min-w-48 -translate-x-1/2 rounded-md bg-surface-2 py-1 text-sm text-text shadow-md"
        >
          {props.speakers.map((s) => (
            <li key={s.deviceId} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={props.sinkId === s.deviceId}
                onClick={() => {
                  props.onSelect(s.deviceId);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-surface-3"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

/** HTMLMediaElement.setSinkId chưa có ở mọi trình duyệt (Firefox cũ, Safari) → ẩn nút. */
export const supportsSinkId = () =>
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export function CallControls(props: {
  micEnabled: boolean;
  camEnabled: boolean;
  showCamera: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onEnd: () => void;
  endKind: 'cancel' | 'hangup';
  captions?: boolean;
  onSwitchCamera?: () => void;
  speakers?: { deviceId: string; label: string }[];
  sinkId?: string | null;
  onSpeaker?: (deviceId: string) => void;
}) {
  const micLabel = props.micEnabled ? vi.calls.micOff : vi.calls.micOn;
  const camLabel = props.camEnabled ? vi.calls.camOff : vi.calls.camOn;
  const speakers = props.speakers ?? [];
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
      {props.onSwitchCamera ? (
        <Round
          label={vi.calls.switchCamera}
          icon={<SwitchCamera size={22} aria-hidden="true" />}
          onClick={props.onSwitchCamera}
        />
      ) : null}
      {props.onSpeaker && speakers.length > 0 && supportsSinkId() ? (
        <SpeakerMenu speakers={speakers} sinkId={props.sinkId ?? null} onSelect={props.onSpeaker} />
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
