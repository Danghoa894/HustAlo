// client/src/components/ui/UnreadBadge.tsx — số tin chưa đọc trên dòng danh sách chat (ui_ux_spec.md §3.2, §6.2):
// > 99 → "99+"; aria-hidden vì số đã có trong tên truy cập của dòng.
import { vi } from '../../i18n/vi';

export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="unread-badge"
      className="min-w-[20px] shrink-0 rounded-pill bg-primary px-1.5 text-center text-xs font-semibold leading-5 text-primary-on"
    >
      {vi.conversations.unreadBadge(count)}
    </span>
  );
}
