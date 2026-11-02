// client/src/features/calls/LocalVideo.tsx — video cục bộ (muted, playsInline, mirror camera trước) — §3.6, §3.7
import { useEffect, useRef } from 'react';

export function LocalVideo({ stream, className = '' }: { stream: MediaStream | null; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const hasVideo = !!stream && stream.getVideoTracks().length > 0;
  useEffect(() => {
    if (ref.current && hasVideo) ref.current.srcObject = stream;
  }, [stream, hasVideo]);
  if (!hasVideo) return null;
  return <video ref={ref} muted playsInline autoPlay className={`-scale-x-100 object-cover ${className}`} />;
}
