// client/src/features/calls/useRingtone.ts — nhạc chuông cuộc gọi đến (/sounds/ringtone.mp3) và âm chờ khi RINGING
// (/sounds/ringback.mp3), phát lặp; autoplay bị chặn → AutoplayUnlockButton (EC-CALL-MEDIA-010, FR-CALL-011).
import { useEffect } from 'react';
import { forget, playOrQueue } from './autoplay';

export const RINGTONE_URL = '/sounds/ringtone.mp3';
export const RINGBACK_URL = '/sounds/ringback.mp3';

export function useRingtone(url: string, active: boolean): void {
  useEffect(() => {
    if (!active || typeof Audio === 'undefined') return;
    const el = new Audio(url);
    el.loop = true;
    playOrQueue(el);
    return () => {
      el.pause();
      forget(el);
    };
  }, [url, active]);
}
