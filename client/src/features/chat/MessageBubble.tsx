// client/src/features/chat/MessageBubble.tsx — bubble tin TEXT (ui_ux_spec.md §3.3, §6.2): role="article",
// aria-label "{tên}, {giờ}"; nội dung dir="auto" (RTL, EC-MSG-003) và React escape (không dangerouslySetInnerHTML,
// EC-MSG-004); thu hồi / không hiển thị được → placeholder nghiêng. Bubble outbox: PENDING mờ 70% + 🕒, FAILED ⚠ +
// "Thử lại"/"Xóa" (NOT_A_MEMBER, USER_BLOCKED chỉ "Xóa").
import type { Message } from '@hustalo/shared';
import { AlertCircle, Ban } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { vi } from '../../i18n/vi';
import type { OutboxItem } from '../../lib/outbox/outbox.db';
import { useE2eeStore } from '../../stores/e2ee.store';
import { formatClock } from '../../lib/time/format';
import { MessageActions } from './MessageActions';
import { MessageMeta } from './MessageMeta';
import { MessageStatusIcon } from './MessageStatusIcon';
import type { OwnStatus } from './message-state';

const bubbleBase = 'max-w-[min(75%,560px)] rounded-bubble px-3 py-2 text-base';
const bubbleTone = (mine: boolean) => (mine ? 'bg-bubble-out text-bubble-on-out' : 'bg-bubble-in text-text');

const SECRET_PLACEHOLDER = {
  NOT_FOR_DEVICE: vi.e2ee.notForDevice,
  REVOKED_DEVICE: vi.e2ee.fromRevokedDevice,
  DECRYPT_FAILED: vi.e2ee.decryptFailed,
} as const;

function Body({ m, mine }: { m: Message; mine: boolean }) {
  // Trên bubble của mình (nền primary) chữ phụ phải giữ màu chữ bubble để đủ tương phản AA.
  const muted = mine ? '' : 'text-text-secondary';
  const secret = useE2eeStore((s) => s.placeholders[m.id]);
  if (m.deletedAt !== null) {
    return (
      <span className={`inline-flex items-center gap-1 italic ${muted}`}>
        <Ban size={14} aria-hidden="true" />
        {vi.chat.revoked}
      </span>
    );
  }
  if (m.content === null) {
    // SECRET không có bản rõ cho device này (ui_ux_spec.md §3.3, EC-E2EE-004..007).
    const text = m.ciphertext !== null ? SECRET_PLACEHOLDER[secret ?? 'NOT_FOR_DEVICE'] : vi.chat.unreadable;
    return <span className={`italic ${muted}`}>{text}</span>;
  }
  return (
    <span dir="auto" className="bubble-text whitespace-pre-wrap break-words">
      {m.content}
    </span>
  );
}

export interface MessageBubbleProps {
  message: Message;
  meId: string;
  mine: boolean;
  first: boolean;
  last: boolean;
  showName: boolean;
  status: OwnStatus | null;
  editing: boolean;
  footer?: ReactNode;
  onEdit: (m: Message) => void;
  onRecall: (m: Message) => Promise<boolean>;
}

export function MessageBubble({
  message: m,
  meId,
  mine,
  first,
  last,
  showName,
  status,
  editing,
  footer,
  onEdit,
  onRecall,
}: MessageBubbleProps) {
  const time = formatClock(m.createdAt);
  const name = m.sender.displayName;
  return (
    <div className={`group flex items-end gap-2 px-4 ${first ? 'mt-2' : 'mt-0.5'} ${mine ? 'flex-row-reverse' : ''}`}>
      {!mine ? <span className="w-8 shrink-0">{last ? <Avatar name={name} size={32} /> : null}</span> : null}
      <div
        role="article"
        aria-label={vi.chat.bubbleLabel(name, time)}
        tabIndex={0}
        data-message-id={m.id}
        className={`flex min-w-0 flex-col outline-none ${mine ? 'items-end' : 'items-start'}`}
      >
        {showName ? <span className="px-1 text-xs font-medium text-text-secondary">{name}</span> : null}
        <div className={`flex items-center gap-1 ${mine ? 'flex-row-reverse' : ''}`}>
          <div title={time} className={`${bubbleBase} ${bubbleTone(mine)} ${editing ? 'ring-2 ring-primary' : ''}`}>
            <Body m={m} mine={mine} />
          </div>
          <MessageActions message={m} meId={meId} onEdit={onEdit} onRecall={onRecall} />
        </div>
        <MessageMeta time={last ? time : null} edited={m.editedAt !== null && m.deletedAt === null}>
          {status && last ? <MessageStatusIcon status={status} /> : null}
        </MessageMeta>
        {footer}
      </div>
    </div>
  );
}

export function PendingBubble({
  item,
  onRetry,
  onRemove,
}: {
  item: OutboxItem;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const failed = item.status === 'FAILED';
  const canRetry = failed && item.error !== 'NOT_A_MEMBER' && item.error !== 'USER_BLOCKED';
  return (
    <div className="mt-2 flex flex-row-reverse items-end gap-2 px-4">
      <div
        role="article"
        aria-label={vi.chat.status[item.status === 'FAILED' ? 'FAILED' : 'PENDING']}
        className="flex min-w-0 flex-col items-end"
      >
        <div className={`${bubbleBase} ${bubbleTone(true)} ${failed ? '' : 'opacity-70'}`}>
          <span dir="auto" className="bubble-text whitespace-pre-wrap break-words">
            {item.content}
          </span>
        </div>
        <span className="mt-0.5 flex items-center gap-2 px-1 text-xs">
          {failed ? (
            <>
              <AlertCircle size={14} aria-hidden="true" className="text-danger" />
              {canRetry ? (
                <button type="button" onClick={onRetry} className="min-h-[24px] font-medium text-danger underline">
                  {vi.chat.retry}
                </button>
              ) : null}
              <button type="button" onClick={onRemove} className="min-h-[24px] text-text-secondary underline">
                {vi.chat.remove}
              </button>
            </>
          ) : (
            <MessageStatusIcon status="PENDING" />
          )}
        </span>
        {item.error === 'NOT_A_MEMBER' ? (
          <span className="px-1 text-xs text-danger">{vi.chat.failedNotMember}</span>
        ) : null}
      </div>
    </div>
  );
}
