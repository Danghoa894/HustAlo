// client/src/features/chat/MessageMeta.tsx — giờ + "Đã chỉnh sửa" + icon trạng thái dưới bubble (ui_ux_spec.md §3.3)
import type { ReactNode } from 'react';
import { vi } from '../../i18n/vi';

export function MessageMeta({
  time,
  edited,
  children,
}: {
  time: string | null;
  edited: boolean;
  children?: ReactNode;
}) {
  if (!time && !edited && !children) return null;
  return (
    <span className="mt-0.5 flex items-center gap-1 px-1 text-xs text-text-secondary">
      {edited ? <span>{vi.chat.edited}</span> : null}
      {time ? <time>{time}</time> : null}
      {children}
    </span>
  );
}
