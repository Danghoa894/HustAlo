// client/src/features/presence/OnlineDot.tsx — chấm xanh góc avatar khi ONLINE (ui_ux_spec.md §3.2, §6.2):
// aria-label "Đang hoạt động"; OFFLINE hoặc degraded → không hiển thị gì.
import { vi } from '../../i18n/vi';
import { usePresence } from './usePresence';

export function OnlineDot({ userId, size = 12 }: { userId: string | undefined; size?: number }) {
  const p = usePresence(userId);
  if (p?.status !== 'ONLINE') return null;
  return (
    <span
      role="img"
      aria-label={vi.presence.online}
      className="absolute bottom-0 right-0 rounded-pill border-2 border-surface-2 bg-success"
      style={{ width: size, height: size }}
    />
  );
}
