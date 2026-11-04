// client/src/features/chat/E2eeBadge.tsx — badge E2EE trên header phòng SECRET (ui_ux_spec.md §3.3, §4.5):
// chưa có session → Lock + "Đang thiết lập mã hóa…" (text-secondary); có session → Lock + "Mã hóa đầu-cuối" (success),
// bấm → SafetyNumberDialog; mọi device peer đã xác minh → thêm ShieldCheck "Đã xác minh". Chỉ "Mã hóa đầu-cuối" khi
// session đã thật sự thiết lập (AC-122, CLAUDE.md).
import { Lock, ShieldCheck } from 'lucide-react';
import { vi } from '../../i18n/vi';
import type { SecretStatus } from '../e2ee/useSecretSession';

export function E2eeBadge({ status, onOpen }: { status: SecretStatus; onOpen: () => void }) {
  if (status === 'SETTING_UP') {
    return (
      <span data-testid="e2ee-badge" className="inline-flex items-center gap-1 text-xs text-text-secondary">
        <Lock size={12} aria-hidden="true" />
        {vi.e2ee.settingUp}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="e2ee-badge"
      onClick={onOpen}
      className="inline-flex items-center gap-1 rounded-sm text-xs text-success hover:underline"
    >
      <Lock size={12} aria-hidden="true" />
      {vi.e2ee.encrypted}
      {status === 'VERIFIED' ? (
        <>
          <ShieldCheck size={12} aria-hidden="true" />
          {vi.e2ee.verified}
        </>
      ) : null}
    </button>
  );
}
