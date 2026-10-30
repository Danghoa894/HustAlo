import type { Conversation, Message } from '@hustalo/shared';
import { describe, expect, it } from 'vitest';
import type { OutboxItem } from '../../lib/outbox/outbox.db';
import { formatDayDivider } from '../../lib/time/format';
import { buildRows, readBy, statusOf } from './message-rows';

const ME = 'a'.repeat(24);
const BOB = 'b'.repeat(24);
const CAROL = 'c'.repeat(24);

let seq = 0;
function msg(senderId: string, createdAt: string, over: Partial<Message> = {}): Message {
  seq += 1;
  return {
    id: `6500000000000000000000${String(seq).padStart(2, '0')}`,
    conversationId: 'f'.repeat(24),
    senderId,
    sender: { id: senderId, displayName: senderId === ME ? 'Alice' : 'Bob' },
    senderDeviceId: null,
    clientMessageId: null,
    type: 'TEXT',
    content: 'hi',
    ciphertext: null,
    system: null,
    receipt: null,
    createdAt,
    editedAt: null,
    deletedAt: null,
    ...over,
  };
}

describe('features/chat/message-rows (ui_ux_spec.md §3.3)', () => {
  it('gom nhóm cùng người gửi ≤ 5 phút; SYSTEM và ngăn ngày cắt nhóm', () => {
    const a = msg(BOB, '2026-10-20T09:00:00.000Z');
    const b = msg(BOB, '2026-10-20T09:04:00.000Z');
    const c = msg(BOB, '2026-10-20T09:10:00.000Z'); // cách 6 phút
    const s = msg(BOB, '2026-10-20T09:11:00.000Z', { type: 'SYSTEM', content: null });
    const d = msg(BOB, '2026-10-20T09:12:00.000Z');
    const rows = buildRows([a, b, c, s, d], [], ME, null);
    const flags = rows.flatMap((r) => (r.kind === 'message' ? [[r.first, r.last]] : []));
    expect(flags).toEqual([
      [true, false],
      [false, true],
      [true, true],
      [true, true],
    ]);
    expect(rows.filter((r) => r.kind === 'date')).toHaveLength(1);
    expect(rows.some((r) => r.kind === 'system')).toBe(true);
  });

  it('ngăn "Tin nhắn chưa đọc" trước tin đầu tiên của người khác sau cursor đọc', () => {
    const a = msg(BOB, '2026-10-20T09:00:00.000Z');
    const b = msg(ME, '2026-10-20T09:01:00.000Z');
    const c = msg(BOB, '2026-10-20T09:02:00.000Z');
    const rows = buildRows([a, b, c], [], ME, a.id);
    const i = rows.findIndex((r) => r.kind === 'unread');
    expect(rows[i + 1]).toMatchObject({ kind: 'message', key: c.id });
  });

  it('bubble outbox luôn nằm sau tin đã có createdAt server', () => {
    const a = msg(BOB, '2026-10-20T09:00:00.000Z');
    const item = { clientMessageId: 'x', status: 'PENDING' } as OutboxItem;
    const rows = buildRows([a], [item], ME, null);
    expect(rows.at(-1)).toMatchObject({ kind: 'pending', key: 'x' });
    // message:new của chính mình tới trước ACK → không hiện hai bubble
    const echoed = msg(ME, '2026-10-20T09:01:00.000Z', { clientMessageId: 'x' });
    expect(buildRows([a, echoed], [item], ME, null).some((r) => r.kind === 'pending')).toBe(false);
  });

  it('ngăn ngày: Hôm nay / Hôm qua / "Thứ Hai, 20/10/2026"', () => {
    const now = new Date(2026, 9, 30, 12);
    expect(formatDayDivider(new Date(2026, 9, 30, 8).toISOString(), now)).toBe('Hôm nay');
    expect(formatDayDivider(new Date(2026, 9, 29, 23).toISOString(), now)).toBe('Hôm qua');
    expect(formatDayDivider(new Date(2026, 9, 19, 10).toISOString(), now)).toBe('Thứ Hai, 19/10/2026');
  });

  it('GROUP: ✓✓ khi mọi thành viên khác đã nhận, ✓✓ xanh khi đã đọc; "Đã xem bởi X/Y"', () => {
    const m = msg(ME, '2026-10-20T09:00:00.000Z');
    const member = (userId: string, d: string | null, r: string | null) => ({
      userId,
      lastDeliveredMessageId: d,
      lastReadMessageId: r,
    });
    const conv = (members: ReturnType<typeof member>[]) =>
      ({ type: 'GROUP', members: [member(ME, m.id, m.id), ...members] }) as unknown as Conversation;
    expect(statusOf(m, conv([member(BOB, m.id, null), member(CAROL, null, null)]), ME)).toBe('SENT');
    expect(statusOf(m, conv([member(BOB, m.id, null), member(CAROL, m.id, null)]), ME)).toBe('DELIVERED');
    expect(statusOf(m, conv([member(BOB, m.id, m.id), member(CAROL, m.id, m.id)]), ME)).toBe('READ');
    expect(readBy(m, conv([member(BOB, m.id, m.id), member(CAROL, m.id, null)]), ME)).toEqual({ read: 1, total: 2 });
  });
});
