// client/src/features/calls/RemoteAudio.tsx — <audio autoPlay> cho stream bên kia; play() bị chặn → AutoplayUnlockButton;
// "Chọn loa" → setSinkId(sinkId) khi trình duyệt hỗ trợ (§3.7).
import { useEffect, useRef } from 'react';
import { forget, playOrQueue } from './autoplay';

type SinkCapable = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

export function RemoteAudio({ stream, sinkId = null }: { stream: MediaStream | null; sinkId?: string | null }) {
  const ref = useRef<SinkCapable>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    playOrQueue(el);
    return () => {
      forget(el);
    };
  }, [stream]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !sinkId || typeof el.setSinkId !== 'function') return;
    void el.setSinkId(sinkId).catch(() => undefined);
  }, [sinkId, stream]);
  return <audio ref={ref} autoPlay data-testid="remote-audio" />;
}
