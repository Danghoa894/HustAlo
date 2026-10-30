// client/src/features/chat/BlockedComposerNotice.tsx — thay Composer khi canMessage = false (FR-USER-004, EC-MSG-011)
import { Button } from '../../components/ui/Button';
import { vi } from '../../i18n/vi';

export function BlockedComposerNotice({
  blockedByMe,
  onUnblock,
  busy,
}: {
  blockedByMe: boolean;
  onUnblock: () => void;
  busy: boolean;
}) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 border-t border-border bg-surface-2 px-4 py-3 pb-[max(12px,var(--safe-bottom))] text-sm text-text-secondary"
    >
      <span>{blockedByMe ? vi.chat.youBlocked : vi.chat.cannotMessage}</span>
      {blockedByMe ? (
        <Button variant="secondary" loading={busy} onClick={onUnblock}>
          {vi.chat.unblock}
        </Button>
      ) : null}
    </div>
  );
}
