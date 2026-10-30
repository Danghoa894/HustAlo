// client/src/features/chat/ReadByIndicator.tsx — GROUP: "Đã xem bởi X/Y" dưới tin cuối của mình (FR-CHAT-004)
import { vi } from '../../i18n/vi';

export function ReadByIndicator({ read, total }: { read: number; total: number }) {
  return <p className="px-1 text-right text-xs text-text-secondary">{vi.chat.readBy(read, total)}</p>;
}
