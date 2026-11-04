// client/src/features/e2ee/IdentityChangedBanner.tsx — banner "Mã an toàn với {tên} đã thay đổi" [Xem] [Chấp nhận]
// (ui_ux_spec.md §3.3, §4.5; FR-E2EE-006, EC-E2EE-003). "Xem" mở SafetyNumberDialog; "Chấp nhận" cập nhật identity đã
// biết và xóa trạng thái đã xác minh (AC-113).
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { vi } from '../../i18n/vi';

export function IdentityChangedBanner({
  peerName,
  onView,
  onAccept,
}: {
  peerName: string;
  onView: () => void;
  onAccept: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const btn = 'min-h-[32px] rounded-md px-3 text-sm font-medium underline-offset-2 hover:underline disabled:opacity-60';
  return (
    <Banner tone="warning">
      <AlertTriangle size={16} aria-hidden="true" />
      <span dir="auto" className="min-w-0 flex-1">
        {vi.e2ee.identityChanged(peerName)}
      </span>
      <button type="button" className={btn} onClick={onView}>
        {vi.e2ee.view}
      </button>
      <button
        type="button"
        className={btn}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onAccept().finally(() => {
            setBusy(false);
          });
        }}
      >
        {vi.e2ee.accept}
      </button>
    </Banner>
  );
}
