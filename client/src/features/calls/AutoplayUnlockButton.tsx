// client/src/features/calls/AutoplayUnlockButton.tsx — "Chạm để bật âm thanh" khi autoplay bị chặn (EC-CALL-MEDIA-010)
import { VolumeX } from 'lucide-react';
import { vi } from '../../i18n/vi';
import { useCallStore } from '../../stores/call.store';
import { unlockAll } from './autoplay';

export function AutoplayUnlockButton() {
  const blocked = useCallStore((s) => s.autoplayBlocked);
  if (!blocked) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void unlockAll();
      }}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-pill bg-white/15 px-4 text-base font-medium text-white hover:bg-white/25"
    >
      <VolumeX size={18} aria-hidden="true" />
      {vi.calls.tapToUnmute}
    </button>
  );
}
