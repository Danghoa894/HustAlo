// client/src/features/calls/CallEndedNotice.tsx — thông báo kết thúc theo kiến trúc §8.6 (tự đóng do controller hẹn giờ)
import { Button } from '../../components/ui/Button';
import { vi } from '../../i18n/vi';
import type { EndedNotice } from '../../stores/call.store';

export function CallEndedNotice({ notice, onCallAgain }: { notice: EndedNotice; onCallAgain: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 text-white">
      <p role="status" className="text-lg font-semibold">
        {notice.text}
      </p>
      {notice.retry ? <Button onClick={onCallAgain}>{vi.calls.callBackButton}</Button> : null}
    </div>
  );
}
