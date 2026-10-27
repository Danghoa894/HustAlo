// client/src/features/chat/EmptyRoomPlaceholder.tsx — /chats khi chưa chọn hội thoại (ui_ux_spec.md §2)
import { vi } from '../../i18n/vi';

export function EmptyRoomPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-base text-text-secondary">
      {vi.chat.emptyRoom}
    </div>
  );
}
