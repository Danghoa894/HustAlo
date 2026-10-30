// client/src/features/conversations/ConversationListItem.tsx — một dòng danh sách chat (ui_ux_spec.md §3.2, §6.2).
// Tên truy cập "{tên}, {n} tin chưa đọc, {preview}" nằm trong span sr-only, phần hiển thị aria-hidden — không dùng
// aria-label để không lệch giữa chữ hiển thị và tên (WCAG 2.5.3, axe label-content-name-mismatch).
// UnreadBadge (M3): số chưa đọc, > 99 → "99+", aria-hidden (số đã có trong tên truy cập). Chấm online, typing ở M4.
import type { ConversationSummary } from '@hustalo/shared';
import { NavLink } from 'react-router-dom';
import { Avatar } from '../../components/ui/Avatar';
import { UnreadBadge } from '../../components/ui/UnreadBadge';
import { formatListTime } from '../../lib/time/format';
import { conversationName, previewOf, rowLabel } from './summary';

export function ConversationListItem({ c, meId }: { c: ConversationSummary; meId: string }) {
  const name = conversationName(c);
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
        <Avatar name={name} size={48} />
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
              className={`truncate text-sm ${c.unreadCount > 0 ? 'font-medium text-text' : 'text-text-secondary'}`}
            >
              {previewOf(c, meId)}
            </span>
            <UnreadBadge count={c.unreadCount} />
          </span>
        </span>
      </NavLink>
    </li>
  );
}
