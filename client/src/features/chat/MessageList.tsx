// client/src/features/chat/MessageList.tsx — danh sách tin role="log" (ui_ux_spec.md §3.3, §6.2):
// - Mở phòng: cuộn tới ngăn "Tin nhắn chưa đọc" nếu có, ngược lại cuộn cuối.
// - "Ở cuối" = cách đáy ≤ 120 px. Tin mới khi ở cuối hoặc tin của mình → cuộn cuối; không → NewMessagesButton (EC-MSG-013).
// - Gần đỉnh ≤ 200 px → tải trang `before`, giữ vị trí nhìn bằng bù chênh lệch scrollHeight.
import type { Conversation, Message } from '@hustalo/shared';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { vi } from '../../i18n/vi';
import { formatDayDivider } from '../../lib/time/format';
import { useOutboxStore } from '../../stores/outbox.store';
import { getOutbox } from './chat-runtime';
import { DateDivider } from './DateDivider';
import { MessageBubble, PendingBubble } from './MessageBubble';
import { NewMessagesButton } from './NewMessagesButton';
import { ReadByIndicator } from './ReadByIndicator';
import { SystemMessage } from './SystemMessage';
import { buildRows, readBy, statusOf } from './message-rows';
import { systemViewOf } from './system-text';

export const AT_BOTTOM_PX = 120;
export const LOAD_OLDER_PX = 200;

export interface MessageListProps {
  conversation: Conversation;
  meId: string;
  messages: Message[];
  hasOlder: boolean;
  loadingOlder: boolean;
  olderError: boolean;
  unreadAfterId: string | null;
  editingId: string | null;
  onLoadOlder: () => Promise<void>;
  onEdit: (m: Message) => void;
  onRecall: (m: Message) => Promise<boolean>;
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function MessageList(props: MessageListProps) {
  const { conversation, meId, messages, hasOlder, loadingOlder, olderError, unreadAfterId, editingId } = props;
  const outboxItems = useOutboxStore((s) => s.items);
  const pending = useMemo(
    () => outboxItems.filter((i) => i.conversationId === conversation.id),
    [outboxItems, conversation.id],
  );
  const rows = useMemo(
    () => buildRows(messages, pending, meId, unreadAfterId),
    [messages, pending, meId, unreadAfterId],
  );
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevHeight = useRef<number | null>(null);
  const lastSeen = useRef<{ id: string | undefined; pendingCount: number } | null>(null);
  const [newCount, setNewCount] = useState(0);

  const isGroup = conversation.type === 'GROUP';
  const myLast = isGroup ? messages.filter((m) => m.senderId === meId && m.type === 'TEXT').at(-1) : undefined;

  const scrollToBottom = (smooth: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
    atBottom.current = true;
    setNewCount(0);
  };

  // Giữ vị trí khi tải trang cũ; xử lý tin mới cuối danh sách.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    }
    const last = messages.at(-1);
    const prev = lastSeen.current;
    lastSeen.current = { id: last?.id, pendingCount: pending.length };
    if (prev === null) {
      const divider = el.querySelector<HTMLElement>('[data-unread-divider]');
      if (divider && typeof divider.scrollIntoView === 'function') divider.scrollIntoView({ block: 'start' });
      else el.scrollTop = el.scrollHeight;
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
      return;
    }
    const grewPending = pending.length > prev.pendingCount;
    if (last?.id === prev.id && !grewPending) return;
    if (atBottom.current || grewPending || last?.senderId === meId) {
      scrollToBottom(true);
      return;
    }
    if (last && last.id !== prev.id) {
      const idx = prev.id ? messages.findIndex((m) => m.id === prev.id) : -1;
      const fresh = messages.slice(idx + 1).filter((m) => m.senderId !== meId).length;
      if (fresh > 0) setNewCount((n) => n + fresh);
    }
  }, [messages, pending.length, meId]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
    if (atBottom.current && newCount > 0) setNewCount(0);
    if (el.scrollTop <= LOAD_OLDER_PX && hasOlder && !loadingOlder && !olderError) {
      prevHeight.current = el.scrollHeight;
      void props.onLoadOlder();
    }
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={onScroll}
        role="log"
        aria-label={vi.chat.messagesLog}
        aria-live="off"
        className="h-full overflow-y-auto pb-3"
      >
        {loadingOlder ? (
          <div className="flex justify-center py-2">
            <Spinner size={16} label={vi.app.loading} />
          </div>
        ) : null}
        {olderError ? (
          <div className="flex items-center justify-center gap-2 py-2 text-sm text-text-secondary">
            <span>{vi.chat.loadError}</span>
            <Button variant="secondary" onClick={() => void props.onLoadOlder()}>
              {vi.chat.retry}
            </Button>
          </div>
        ) : null}
        {!hasOlder && messages.length > 0 ? (
          <p className="py-3 text-center text-xs text-text-secondary">{vi.chat.startOfConversation}</p>
        ) : null}
        {rows.map((r) => {
          switch (r.kind) {
            case 'date':
              return <DateDivider key={r.key} label={formatDayDivider(r.iso)} />;
            case 'unread':
              return (
                <div key={r.key} data-unread-divider="">
                  <DateDivider label={vi.chat.unreadDivider} />
                </div>
              );
            case 'system': {
              const view = systemViewOf(r.message);
              return view ? <SystemMessage key={r.key} system={view} /> : null;
            }
            case 'pending':
              return (
                <PendingBubble
                  key={r.key}
                  item={r.item}
                  onRetry={() => void getOutbox()?.retry(r.item.clientMessageId)}
                  onRemove={() => void getOutbox()?.remove(r.item.clientMessageId)}
                />
              );
            case 'message': {
              const m = r.message;
              const rb = myLast?.id === m.id ? readBy(m, conversation, meId) : null;
              return (
                <MessageBubble
                  key={r.key}
                  message={m}
                  meId={meId}
                  mine={r.mine}
                  first={r.first}
                  last={r.last}
                  showName={isGroup && !r.mine && r.first}
                  status={r.mine ? statusOf(m, conversation, meId) : null}
                  editing={editingId === m.id}
                  footer={rb ? <ReadByIndicator read={rb.read} total={rb.total} /> : null}
                  onEdit={props.onEdit}
                  onRecall={props.onRecall}
                />
              );
            }
          }
        })}
      </div>
      {newCount > 0 ? (
        <NewMessagesButton
          count={newCount}
          onClick={() => {
            scrollToBottom(true);
          }}
        />
      ) : null}
    </div>
  );
}
