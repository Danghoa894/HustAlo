// client/src/features/calls/MediaErrorPanel.tsx — lỗi getUserMedia (ui_ux_spec.md §4.4): quyền bị từ chối → hướng dẫn;
// micro thiếu/bận → "Thử lại" (chỉ phía người gọi); luôn có "Đóng".
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { vi } from '../../i18n/vi';
import type { MediaErrorKind } from '../../lib/webrtc/media';

const TEXT: Partial<Record<MediaErrorKind, string>> = {
  PERMISSION_DENIED: vi.calls.media.PERMISSION_DENIED,
  MIC_NOT_FOUND: vi.calls.media.MIC_NOT_FOUND,
  MIC_IN_USE: vi.calls.media.MIC_IN_USE,
  CAMERA_IN_USE: vi.calls.media.CAMERA_IN_USE,
  INSECURE_CONTEXT: vi.calls.insecure,
  UNSUPPORTED: vi.calls.unsupported,
};

// Mô tả cách mở quyền (§4.4 "Hướng dẫn cấp quyền" — hiện ngay trong panel).
const HELP = vi.calls.media.permissionSteps;

export function MediaErrorPanel(props: { kind: MediaErrorKind; onRetry?: () => void; onClose: () => void }) {
  const [help, setHelp] = useState(false);
  const retryable = props.kind === 'MIC_NOT_FOUND' || props.kind === 'MIC_IN_USE';
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-sm flex-col items-center gap-4 rounded-lg bg-white/10 p-5 text-center text-white"
    >
      <p className="text-md">{TEXT[props.kind] ?? vi.calls.media.MIC_IN_USE}</p>
      {help ? <p className="text-sm text-white/80">{HELP}</p> : null}
      <div className="flex flex-wrap justify-center gap-2">
        {props.kind === 'PERMISSION_DENIED' ? (
          <Button
            variant="secondary"
            onClick={() => {
              setHelp(true);
            }}
          >
            {vi.calls.media.permissionHelp}
          </Button>
        ) : null}
        {retryable && props.onRetry ? <Button onClick={props.onRetry}>{vi.calls.media.retry}</Button> : null}
        <Button variant="ghost" className="text-white" onClick={props.onClose}>
          {vi.calls.media.close}
        </Button>
      </div>
    </div>
  );
}
