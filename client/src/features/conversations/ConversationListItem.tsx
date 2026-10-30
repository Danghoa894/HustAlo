// client/src/features/conversations/ConversationListItem.tsx — một dòng danh sách chat (ui_ux_spec.md §3.2, §6.2).
// Tên truy cập "{tên}, {n} tin chưa đọc, {preview}" nằm trong span sr-only, phần hiển thị aria-hidden — không dùng
// aria-label để không lệch giữa chữ hiển thị và tên (WCAG 2.5.3, axe label-content-name-mismatch).
// UnreadBadge (M3): số chưa đọc, > 99 → "99+", aria-hidden (số đã có trong tên truy cập).
// M4: OnlineDot (DIRECT/SECRET), preview ưu tiên "đang soạn tin…" (màu primary, nghiêng). Tên người gõ trong GROUP lấy
// từ Q['conversation', id] nếu đã tải; chưa tải → chỉ "đang soạn tin…".
import type { Conversation, ConversationSummary } from '@hustalo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { Avatar } from '../../components/ui/Avatar';
import { UnreadBadge } from '../../components/ui/UnreadBadge';
import { vi } from '../../i18n/vi';
import { formatListTime } from '../../lib/time/format';
import { useTypingStore } from '../../stores/typing.store';
import { OnlineDot } from '../presence/OnlineDot';
import { typingText } from '../presence/presence-text';
import { conversationKeys } from './conversations.api';
import { conversationName, previewOf, rowLabel } from './summary';

const EMPTY: string[] = [];

function useTypingPreview(c: ConversationSummary, meId: string): string | null {
  const queryClient = useQueryClient();
  const ids = useTypingStore((s) => s.byConversation[c.id] ?? EMPTY).filter((id) => id !== meId);
  if (ids.length === 0) return null;
  if (c.type !== 'GROUP') return typingText(c.type, ids);
  const members = queryClient.getQueryData<Conversation>(conversationKeys.one(c.id))?.members;
  const names = ids.map((id) => members?.find((m) => m.userId === id)?.user.displayName);
  return names.every((n): n is string => Boolean(n)) ? typingText('GROUP', names) : vi.typing.direct;
}

export function ConversationListItem({ c, meId }: { c: ConversationSummary; meId: string }) {
  const name = conversationName(c);
  const typing = useTypingPreview(c, meId);
  const preview = typing ?? previewOf(c, meId);
  return (
    <li role="listitem">
      <NavLink
        to={`/chats/${c.id}`}
        data-conversation-link=""
        className={({ isActive }) =>
          `flex min-h-[64px] items-center gap-3 px-4 py-2 outline-none hover:bg-surface-3 focus-visible:bg-surface-3 ${isActive ? 'bg-surface-3' : ''}`
        }
      >
        <span className="sr-only">{rowLabel(c, meId)}</span>
        <span className="relative shrink-0">
          <Avatar name={name} size={48} />
          <OnlineDot userId={c.type === 'GROUP' ? undefined : c.peer?.id} />
        </span>
        <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline justify-between gap-2">
            <span dir="auto" className="truncate text-base font-medium text-text">
              {name}
            </span>
            <span className="shrink-0 text-xs text-text-secondary">
              {formatListTime(c.lastMessage?.createdAt ?? c.lastMessageAt)}
            </span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span
              dir="auto"
              data-testid={typing ? 'typing-preview' : undefined}
              className={`truncate text-sm ${typing ? 'italic text-primary' : c.unreadCount > 0 ? 'font-medium text-text' : 'text-text-secondary'}`}
            >
              {preview}
            </span>
            <UnreadBadge count={c.unreadCount} />
          </span>
        </span>
      </NavLink>
    </li>
  );
}
