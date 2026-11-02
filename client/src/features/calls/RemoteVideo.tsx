// client/src/features/calls/RemoteVideo.tsx — video bên kia; không có track video hoặc track mute (chuyển app, tắt
// camera) → Avatar + "Camera đang tạm dừng" (EC-CALL-MEDIA-011, ui_ux_spec.md §3.7).
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { vi } from '../../i18n/vi';
import type { CallPeer } from '../../stores/call.store';
import { playOrQueue } from './autoplay';

function useVideoVisible(stream: MediaStream | null): boolean {
  const [, bump] = useState(0);
  const track = stream?.getVideoTracks()[0];
  useEffect(() => {
    if (!track) return;
    const on = () => {
      bump((n) => n + 1);
    };
    track.addEventListener('mute', on);
    track.addEventListener('unmute', on);
    track.addEventListener('ended', on);
    return () => {
      track.removeEventListener('mute', on);
      track.removeEventListener('unmute', on);
      track.removeEventListener('ended', on);
    };
  }, [track]);
  return !!track && !track.muted && track.readyState !== 'ended';
}

export function RemoteVideo({ stream, peer }: { stream: MediaStream | null; peer: CallPeer }) {
  const ref = useRef<HTMLVideoElement>(null);
  const visible = useVideoVisible(stream);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream || !visible) return;
    el.srcObject = stream;
    playOrQueue(el);
  }, [stream, visible]);
  if (!visible) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-white">
        <Avatar name={peer.displayName} size={120} />
        <p className="text-sm text-white/80">{vi.calls.cameraPaused}</p>
      </div>
    );
  }
  // Âm thanh phát qua RemoteAudio → video luôn muted để không phát hai lần.
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      data-testid="remote-video"
      className="h-full w-full object-cover md:object-contain"
    />
  );
}
