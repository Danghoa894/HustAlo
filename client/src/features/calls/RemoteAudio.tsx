// client/src/features/calls/RemoteAudio.tsx — <audio autoPlay> cho stream bên kia; play() bị chặn → AutoplayUnlockButton
import { useEffect, useRef } from 'react';
import { forget, playOrQueue } from './autoplay';

export function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    playOrQueue(el);
    return () => {
      forget(el);
    };
  }, [stream]);
  return <audio ref={ref} autoPlay data-testid="remote-audio" />;
}
