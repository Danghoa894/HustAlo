// client/src/features/conversations/summary.ts — tên, preview, aria-label của một dòng danh sách chat (ui_ux_spec.md §3.2, §6.2).
// Typing preview (M4) bổ sung ở milestone sau.
import type { ConversationSummary } from '@hustalo/shared';
import { vi } from '../../i18n/vi';
import { systemText } from '../chat/system-text';

export const conversationName = (c: ConversationSummary): string =>
  c.type === 'GROUP' ? (c.title ?? '') : (c.peer?.displayName ?? '');

export function previewOf(c: ConversationSummary, meId: string): string {
  if (c.type !== 'GROUP' && !c.canMessage) {
    return c.blockedByMe ? vi.conversations.youBlocked : vi.conversations.cannotMessage;
  }
  const m = c.lastMessage;
  if (!m) return vi.conversations.noMessages;
  if (m.system) return systemText(m.system, meId);
  const prefix =
    m.senderId === meId
      ? vi.conversations.youPrefix
      : c.type === 'GROUP'
        ? vi.conversations.senderPrefix(m.sender.displayName)
        : '';
  if (m.deletedAt) return `${prefix}${vi.conversations.revoked}`;
  if (c.type === 'SECRET') return vi.conversations.encrypted;
  return `${prefix}${m.preview ?? ''}`;
}

/** Số chưa đọc hiển thị: > UNREAD_COUNT_CAP → "99+" (badge ở M3). */
export function rowLabel(c: ConversationSummary, meId: string): string {
  const parts = [conversationName(c)];
  if (c.unreadCount > 0) parts.push(vi.conversations.unread(c.unreadCount));
  parts.push(previewOf(c, meId));
  return parts.join(', ');
}
