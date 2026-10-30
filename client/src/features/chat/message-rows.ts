// client/src/features/chat/message-rows.ts — dựng danh sách dòng cho MessageList (ui_ux_spec.md §3.3):
// - Ngăn ngày theo múi giờ trình duyệt dựa trên createdAt server; ngăn "Tin nhắn chưa đọc" trước tin chưa đọc đầu tiên.
// - Gom nhóm bubble: cùng senderId, cách nhau ≤ 5 phút, không có ngăn ngày/SYSTEM ở giữa.
// - Bubble PENDING/FAILED của outbox luôn nằm sau tin đã có createdAt server, theo thời gian tạo cục bộ; ẩn khi tin
//   server cùng clientMessageId đã có (message:new tới trước ACK).
// - Trạng thái tin của mình: DIRECT theo receipt; GROUP theo cursor của mọi thành viên khác (FR-CHAT-004).
import type { Conversation, Message } from '@hustalo/shared';
import type { OutboxItem } from '../../lib/outbox/outbox.db';
import { dayKey } from '../../lib/time/format';
import { ownStatus, type OwnStatus } from './message-state';

export const GROUP_GAP_MS = 5 * 60_000;

export type Row =
  | { kind: 'date'; key: string; iso: string }
  | { kind: 'unread'; key: string }
  | { kind: 'system'; key: string; message: Message }
  | { kind: 'message'; key: string; message: Message; first: boolean; last: boolean; mine: boolean }
  | { kind: 'pending'; key: string; item: OutboxItem };

export function buildRows(
  messages: readonly Message[],
  pending: readonly OutboxItem[],
  meId: string,
  unreadAfterId: string | null,
): Row[] {
  const rows: Row[] = [];
  let lastDay = '';
  let unreadPlaced = unreadAfterId === null;
  messages.forEach((m, i) => {
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      rows.push({ kind: 'date', key: `d-${day}`, iso: m.createdAt });
      lastDay = day;
    }
    if (!unreadPlaced && m.senderId !== meId && m.type === 'TEXT' && unreadAfterId !== null && m.id > unreadAfterId) {
      rows.push({ kind: 'unread', key: 'unread' });
      unreadPlaced = true;
    }
    if (m.type === 'SYSTEM') {
      rows.push({ kind: 'system', key: m.id, message: m });
      return;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    rows.push({
      kind: 'message',
      key: m.id,
      message: m,
      mine: m.senderId === meId,
      first: !sameGroup(prev, m),
      last: !sameGroup(m, next),
    });
  });
  // message:new của chính mình có thể tới trước ACK: tin server đã có cùng clientMessageId thì ẩn bản outbox.
  const delivered = new Set(messages.map((m) => m.clientMessageId).filter((id): id is string => id !== null));
  for (const item of pending) {
    if (!delivered.has(item.clientMessageId)) rows.push({ kind: 'pending', key: item.clientMessageId, item });
  }
  return rows;
}

function sameGroup(a: Message | undefined, b: Message | undefined): boolean {
  if (!a || !b || a.type !== 'TEXT' || b.type !== 'TEXT' || a.senderId !== b.senderId) return false;
  if (dayKey(a.createdAt) !== dayKey(b.createdAt)) return false;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) <= GROUP_GAP_MS;
}

/** Cursor `c` đã tới (≥) tin `id`. ObjectId do server cấp tăng theo thời gian tạo. */
const reached = (c: string | null, id: string) => c !== null && c >= id;

/** Trạng thái tin của mình: DIRECT/SECRET theo receipt; GROUP khi mọi thành viên khác đã nhận/đọc. */
export function statusOf(m: Message, conversation: Conversation, meId: string): OwnStatus {
  if (conversation.type !== 'GROUP') return ownStatus(m);
  const others = conversation.members.filter((x) => x.userId !== meId);
  if (others.length === 0) return 'SENT';
  if (others.every((x) => reached(x.lastReadMessageId, m.id))) return 'READ';
  if (others.every((x) => reached(x.lastDeliveredMessageId, m.id) || reached(x.lastReadMessageId, m.id)))
    return 'DELIVERED';
  return 'SENT';
}

/** "Đã xem bởi X/Y" cho tin cuối của mình trong GROUP. */
export function readBy(m: Message, conversation: Conversation, meId: string): { read: number; total: number } {
  const others = conversation.members.filter((x) => x.userId !== meId);
  return { read: others.filter((x) => reached(x.lastReadMessageId, m.id)).length, total: others.length };
}
