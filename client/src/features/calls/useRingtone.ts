// client/src/features/calls/useRingtone.ts — nhạc chuông cuộc gọi đến (/sounds/ringtone.wav) và âm chờ khi RINGING
// (/sounds/ringback.wav), phát lặp; autoplay bị chặn → AutoplayUnlockButton (EC-CALL-MEDIA-010, FR-CALL-011).
import { useEffect } from 'react';
import { forget, playOrQueue } from './autoplay';

export const RINGTONE_URL = '/sounds/ringtone.wav';
export const RINGBACK_URL = '/sounds/ringback.wav';

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
