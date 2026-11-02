// Unit: media.ts — ánh xạ lỗi (ui_ux_spec.md §4.4), fallback camera → âm thanh (FR-CALL-009), hủy khi getUserMedia
// còn chờ (EC-CALL-MEDIA-012), phát hiện thiết bị âm thanh bị rút (EC-CALL-MEDIA-006).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaError, isAudioDeviceGone, mapMediaError, requestMedia } from './media';

const dom = (name: string) => new DOMException('x', name);

interface FakeTrack {
  kind: 'audio' | 'video';
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => { deviceId?: string };
  readyState: 'live' | 'ended';
}
const track = (kind: 'audio' | 'video', deviceId = `${kind}-1`): FakeTrack => ({
  kind,
  stop: vi.fn(),
  getSettings: () => ({ deviceId }),
  readyState: 'live',
});
const stream = (...tracks: FakeTrack[]) =>
  ({
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  }) as unknown as MediaStream;

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('RTCPeerConnection', vi.fn());
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mapMediaError (ui_ux_spec.md §4.4)', () => {
  it('ánh xạ đúng từng DOMException theo loại thiết bị yêu cầu', () => {
    expect(mapMediaError(dom('NotAllowedError'), 'audio')).toBe('PERMISSION_DENIED');
    expect(mapMediaError(dom('SecurityError'), 'video')).toBe('PERMISSION_DENIED');
    expect(mapMediaError(dom('NotFoundError'), 'audio')).toBe('MIC_NOT_FOUND');
    expect(mapMediaError(dom('DevicesNotFoundError'), 'video')).toBe('CAMERA_NOT_FOUND');
    expect(mapMediaError(dom('NotReadableError'), 'audio')).toBe('MIC_IN_USE');
    expect(mapMediaError(dom('TrackStartError'), 'video')).toBe('CAMERA_IN_USE');
    expect(mapMediaError(dom('OverconstrainedError'), 'video')).toBe('OVERCONSTRAINED');
    expect(mapMediaError(dom('AbortError'), 'audio')).toBe('ABORTED');
    expect(mapMediaError(new Error('khác'), 'audio')).toBe('MIC_IN_USE');
  });

  it('TC-CALL-MEDIA-009 TC-CALL-MEDIA-008 insecure context / thiếu WebRTC được ưu tiên trước tên lỗi', () => {
    vi.stubGlobal('isSecureContext', false);
    expect(mapMediaError(dom('NotAllowedError'), 'audio')).toBe('INSECURE_CONTEXT');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('RTCPeerConnection', undefined);
    expect(mapMediaError(dom('NotAllowedError'), 'audio')).toBe('UNSUPPORTED');
  });
});

describe('requestMedia (FR-CALL-009)', () => {
  it('VOICE: chỉ xin micro', async () => {
    const gum = vi.fn(() => Promise.resolve(stream(track('audio'))));
    const r = await requestMedia('VOICE', { getUserMedia: gum }).promise;
    expect(gum).toHaveBeenCalledWith({ audio: true, video: false });
    expect(r).toMatchObject({ video: false, warning: null });
  });

  it('VIDEO: xin micro + camera 1280×720', async () => {
    const gum = vi.fn(() => Promise.resolve(stream(track('audio'), track('video'))));
    const r = await requestMedia('VIDEO', { getUserMedia: gum }).promise;
    expect(gum).toHaveBeenCalledWith({ audio: true, video: { width: 1280, height: 720 } });
    expect(r).toMatchObject({ video: true, warning: null });
  });

  it('TC-CALL-MEDIA-001 không có micro → MediaError MIC_NOT_FOUND (không gửi invite)', async () => {
    const gum = vi.fn(() => Promise.reject(dom('NotFoundError')));
    await expect(requestMedia('VOICE', { getUserMedia: gum }).promise).rejects.toMatchObject({ kind: 'MIC_NOT_FOUND' });
  });

  it('TC-CALL-MEDIA-003 từ chối quyền → PERMISSION_DENIED (VIDEO không thử lại âm thanh)', async () => {
    const gum = vi.fn(() => Promise.reject(dom('NotAllowedError')));
    const err = await requestMedia('VIDEO', { getUserMedia: gum }).promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MediaError);
    expect((err as MediaError).kind).toBe('PERMISSION_DENIED');
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it('TC-CALL-MEDIA-002 VIDEO không có camera → thử lại chỉ âm thanh, giữ VIDEO, cảnh báo CAMERA_NOT_FOUND', async () => {
    const gum = vi
      .fn<(c: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockRejectedValueOnce(dom('NotFoundError'))
      .mockResolvedValueOnce(stream(track('audio')));
    const r = await requestMedia('VIDEO', { getUserMedia: gum }).promise;
    expect(gum).toHaveBeenLastCalledWith({ audio: true, video: false });
    expect(r).toMatchObject({ video: false, warning: 'CAMERA_NOT_FOUND' });
  });

  it('TC-CALL-MEDIA-005 camera bị app khác giữ → âm thanh + CAMERA_IN_USE; micro bị giữ → MIC_IN_USE', async () => {
    const gum = vi
      .fn<(c: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockRejectedValueOnce(dom('NotReadableError'))
      .mockResolvedValueOnce(stream(track('audio')));
    expect(await requestMedia('VIDEO', { getUserMedia: gum }).promise).toMatchObject({ warning: 'CAMERA_IN_USE' });
    const gum2 = vi
      .fn<(c: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockRejectedValueOnce(dom('NotReadableError'))
      .mockRejectedValueOnce(dom('NotReadableError'));
    await expect(requestMedia('VIDEO', { getUserMedia: gum2 }).promise).rejects.toMatchObject({ kind: 'MIC_IN_USE' });
  });

  it('TC-CALL-MEDIA-013 OverconstrainedError → thử { video: true }; vẫn lỗi → âm thanh như camera NotFound', async () => {
    const ok = vi
      .fn<(c: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockRejectedValueOnce(dom('OverconstrainedError'))
      .mockResolvedValueOnce(stream(track('audio'), track('video')));
    const r1 = await requestMedia('VIDEO', { getUserMedia: ok }).promise;
    expect(ok).toHaveBeenLastCalledWith({ audio: true, video: true });
    expect(r1).toMatchObject({ video: true, warning: null });
    const fallback = vi
      .fn<(c: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockRejectedValueOnce(dom('OverconstrainedError'))
      .mockRejectedValueOnce(dom('OverconstrainedError'))
      .mockResolvedValueOnce(stream(track('audio')));
    expect(await requestMedia('VIDEO', { getUserMedia: fallback }).promise).toMatchObject({
      video: false,
      warning: 'CAMERA_NOT_FOUND',
    });
  });

  it('"Trả lời bằng âm thanh": VIDEO nhưng audioOnly → chỉ xin micro', async () => {
    const gum = vi.fn(() => Promise.resolve(stream(track('audio'))));
    await requestMedia('VIDEO', { getUserMedia: gum, audioOnly: true }).promise;
    expect(gum).toHaveBeenCalledWith({ audio: true, video: false });
  });

  it('TC-CALL-MEDIA-012 TC-CALL-MEDIA-004 cuộc gọi kết thúc khi getUserMedia còn chờ → resolve muộn thì stop mọi track, promise ABORTED', async () => {
    const a = track('audio');
    const v = track('video');
    let resolve: (s: MediaStream) => void = () => undefined;
    const gum = vi.fn(() => new Promise<MediaStream>((r) => (resolve = r)));
    const req = requestMedia('VIDEO', { getUserMedia: gum });
    req.cancel();
    resolve(stream(a, v));
    await expect(req.promise).rejects.toMatchObject({ kind: 'ABORTED' });
    expect(a.stop).toHaveBeenCalled();
    expect(v.stop).toHaveBeenCalled();
  });
});

describe('isAudioDeviceGone (EC-CALL-MEDIA-006)', () => {
  const dev = (deviceId: string, kind: MediaDeviceKind = 'audioinput') =>
    ({ deviceId, kind, label: deviceId, groupId: '' }) as MediaDeviceInfo;

  it('TC-CALL-MEDIA-006 thiết bị micro đang dùng không còn trong danh sách / track đã ended → cần chuyển', () => {
    const t = track('audio', 'headset') as unknown as MediaStreamTrack;
    expect(isAudioDeviceGone(t, [dev('headset'), dev('builtin')])).toBe(false);
    expect(isAudioDeviceGone(t, [dev('builtin'), dev('headset', 'videoinput')])).toBe(true);
    expect(
      isAudioDeviceGone({ ...track('audio'), readyState: 'ended' } as unknown as MediaStreamTrack, [dev('audio-1')]),
    ).toBe(true);
    expect(isAudioDeviceGone(undefined, [dev('builtin')])).toBe(false);
  });
});
