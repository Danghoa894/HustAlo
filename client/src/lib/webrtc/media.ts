// client/src/lib/webrtc/media.ts — lấy micro/camera cho cuộc gọi (kiến trúc §7(e), FR-CALL-009, ui_ux_spec.md §4.4):
// - VIDEO: { audio, video 1280×720 } → OverconstrainedError: thử { video: true } → camera thiếu/bận: chỉ âm thanh, giữ
//   callType VIDEO, cảnh báo CAMERA_* (EC-CALL-MEDIA-002/005/013). Lỗi quyền hoặc lỗi micro: dừng (MediaError).
// - requestMedia trả { promise, cancel }: cuộc gọi kết thúc khi getUserMedia còn chờ → stream đến muộn bị stop ngay
//   (EC-CALL-MEDIA-012) và promise reject ABORTED.
import type { CallType } from '@hustalo/shared';

export type MediaErrorKind =
  | 'PERMISSION_DENIED'
  | 'MIC_NOT_FOUND'
  | 'CAMERA_NOT_FOUND'
  | 'MIC_IN_USE'
  | 'CAMERA_IN_USE'
  | 'OVERCONSTRAINED'
  | 'INSECURE_CONTEXT'
  | 'UNSUPPORTED'
  | 'ABORTED';

export function mapMediaError(err: unknown, requested: 'audio' | 'video'): MediaErrorKind {
  if (!window.isSecureContext) return 'INSECURE_CONTEXT';
  // mediaDevices không có ở insecure context / trình duyệt cũ dù kiểu DOM khai báo luôn có.
  const md = navigator.mediaDevices as MediaDevices | undefined;
  if (typeof md?.getUserMedia !== 'function' || typeof RTCPeerConnection === 'undefined') return 'UNSUPPORTED';
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'PERMISSION_DENIED';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return requested === 'audio' ? 'MIC_NOT_FOUND' : 'CAMERA_NOT_FOUND';
    case 'NotReadableError':
    case 'TrackStartError':
      return requested === 'audio' ? 'MIC_IN_USE' : 'CAMERA_IN_USE';
    case 'OverconstrainedError':
      return 'OVERCONSTRAINED';
    case 'AbortError':
      return 'ABORTED';
    default:
      return requested === 'audio' ? 'MIC_IN_USE' : 'CAMERA_IN_USE';
  }
}
// Tên lỗi cũ (DevicesNotFoundError, TrackStartError) của Chrome đời trước vẫn được ánh xạ để an toàn.

export class MediaError extends Error {
  override name = 'MediaError';
  constructor(public readonly kind: MediaErrorKind) {
    super(kind);
  }
}

export interface AcquiredMedia {
  stream: MediaStream;
  /** Có track camera cục bộ (VIDEO nhưng thiếu camera → false, callType vẫn VIDEO). */
  video: boolean;
  /** Cảnh báo không chặn cuộc gọi (toast "Không tìm thấy camera…" / "…đang được ứng dụng khác sử dụng"). */
  warning: 'CAMERA_NOT_FOUND' | 'CAMERA_IN_USE' | null;
}

export interface MediaRequest {
  promise: Promise<AcquiredMedia>;
  cancel(): void;
}

type GetUserMedia = (c: MediaStreamConstraints) => Promise<MediaStream>;

export function stopStream(stream: MediaStream | null | undefined): void {
  for (const t of stream?.getTracks() ?? []) t.stop();
}

const HD = { width: 1280, height: 720 };

export function requestMedia(
  callType: CallType,
  opts: { audioOnly?: boolean; getUserMedia?: GetUserMedia } = {},
): MediaRequest {
  const gum: GetUserMedia = opts.getUserMedia ?? ((c) => navigator.mediaDevices.getUserMedia(c));
  let cancelled = false;
  const live: MediaStream[] = [];

  const take = async (c: MediaStreamConstraints): Promise<MediaStream> => {
    const s = await gum(c);
    live.push(s);
    if (cancelled) {
      stopStream(s);
      throw new MediaError('ABORTED');
    }
    return s;
  };

  const audioOnly = async (warning: AcquiredMedia['warning']): Promise<AcquiredMedia> => {
    try {
      return { stream: await take({ audio: true, video: false }), video: false, warning };
    } catch (err) {
      if (err instanceof MediaError) throw err;
      throw new MediaError(mapMediaError(err, 'audio'));
    }
  };

  const run = async (): Promise<AcquiredMedia> => {
    if (callType === 'VOICE' || opts.audioOnly) return audioOnly(null);
    try {
      return { stream: await take({ audio: true, video: HD }), video: true, warning: null };
    } catch (err) {
      if (err instanceof MediaError) throw err;
      let kind = mapMediaError(err, 'video');
      if (kind === 'OVERCONSTRAINED') {
        try {
          return { stream: await take({ audio: true, video: true }), video: true, warning: null };
        } catch (retry) {
          if (retry instanceof MediaError) throw retry;
          kind = 'CAMERA_NOT_FOUND'; // vẫn lỗi → xử lý như camera NotFound (ui_ux_spec.md §4.4)
        }
      }
      if (kind === 'CAMERA_NOT_FOUND' || kind === 'CAMERA_IN_USE') return audioOnly(kind);
      throw new MediaError(kind);
    }
  };

  return {
    promise: run(),
    cancel: () => {
      cancelled = true;
      for (const s of live) stopStream(s);
    },
  };
}

/** Micro đang dùng không còn trong danh sách thiết bị (rút tai nghe/Bluetooth) hoặc track đã ended (EC-CALL-MEDIA-006). */
export function isAudioDeviceGone(track: MediaStreamTrack | undefined, devices: MediaDeviceInfo[]): boolean {
  if (!track) return false;
  if (track.readyState === 'ended') return true;
  const id = track.getSettings().deviceId;
  if (!id) return false;
  return !devices.some((d) => d.kind === 'audioinput' && d.deviceId === id);
}
