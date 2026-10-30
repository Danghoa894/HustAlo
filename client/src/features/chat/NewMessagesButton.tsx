// client/src/features/chat/NewMessagesButton.tsx — "Tin mới ↓ (n)" khi có tin mới lúc đang cuộn lên (EC-MSG-013)
import { vi } from '../../i18n/vi';

export function NewMessagesButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={vi.chat.newMessagesAria(count)}
      className="absolute bottom-3 right-4 z-sticky min-h-[44px] rounded-pill bg-primary px-4 text-sm font-medium text-primary-on shadow-md"
    >
      <span aria-hidden="true">{vi.chat.newMessages(count)}</span>
    </button>
  );
}
