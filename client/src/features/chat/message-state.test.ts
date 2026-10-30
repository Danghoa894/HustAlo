import type { Message } from '@hustalo/shared';
import { describe, expect, it } from 'vitest';
import { recordServerTime, resetServerClockForTest, serverNow } from '../../lib/time/server-clock';
import { createEventDedupe } from '../../lib/socket/event-dedupe';
import { PendingReceipts, applyStatus, canEditOrRecall, mergeMessages, ownStatus } from './message-state';

const ME = '6720a1b2c3d4e5f601234561';
const BOB = '6720a1b2c3d4e5f601234562';
const msg = (id: string, createdAt: string, over: Partial<Message> = {}): Message => ({
  id,
  conversationId: '6720a1b2c3d4e5f6012345aa',
  senderId: ME,
  sender: { id: ME, displayName: 'Alice' },
  senderDeviceId: null,
  clientMessageId: null,
  type: 'TEXT',
  content: 'x',
  ciphertext: null,
  system: null,
  receipt: { deliveredAt: null, readAt: null },
  createdAt,
  editedAt: null,
  deletedAt: null,
  ...over,
});
const id = (n: number) => `6720a1b2c3d4e5f6012345${String(n).padStart(2, '0')}`;

describe('hợp nhất tin (EC-NET-005, EC-NET-006)', () => {
  it('TC-NET-005 sắp theo (createdAt, id) dù đến sai thứ tự; trùng id → giữ một', () => {
    const a = msg(id(1), '2026-10-28T10:00:00.000Z');
    const b = msg(id(2), '2026-10-28T10:00:00.000Z'); // cùng mili-giây, id lớn hơn
    const c = msg(id(3), '2026-10-28T09:59:59.000Z');
    expect(mergeMessages([b], [c, a, b]).map((m) => m.id)).toEqual([id(3), id(1), id(2)]);
  });

  it('bản mới hơn của cùng tin (sửa / thu hồi) thay bản cũ', () => {
    const a = msg(id(1), '2026-10-28T10:00:00.000Z');
    const edited = { ...a, content: 'mới', editedAt: '2026-10-28T10:01:00.000Z' };
    expect(mergeMessages([a], [edited])[0]?.content).toBe('mới');
  });

  it('TC-NET-006 dedupe eventId: LRU 1000, event trùng bị bỏ', () => {
    const seen = createEventDedupe(3);
    expect(['e1', 'e2', 'e1', 'e3', 'e4', 'e1'].map((e) => seen(e))).toEqual([false, false, true, false, false, false]);
  });
});

describe('receipt một chiều (FR-CHAT-004)', () => {
  it('TC-NET-005 receipt áp theo max: READ rồi DELIVERED đến muộn không hạ cấp', () => {
    const m = msg(id(1), '2026-10-28T10:00:00.000Z');
    const at = '2026-10-28T10:00:05.000Z';
    const read = applyStatus([m], { scope: 'MESSAGE', messageIds: [m.id], status: 'READ', byUserId: BOB, at });
    expect(ownStatus(read.messages[0])).toBe('READ');
    const late = applyStatus(read.messages, {
      scope: 'MESSAGE',
      messageIds: [m.id],
      status: 'DELIVERED',
      byUserId: BOB,
      at,
    });
    expect(ownStatus(late.messages[0])).toBe('READ');
    expect(late.unmatched).toEqual([]);
  });

  it('TC-MSG-008 message:status đến trước message:new: giữ chờ (≤ 500, 60 s), áp khi tin tới', () => {
    const pending = new PendingReceipts(2, 60_000);
    const at = '2026-10-28T10:00:05.000Z';
    pending.add([id(1)], 'DELIVERED', at, 0);
    pending.add([id(2)], 'READ', at, 0);
    pending.add([id(3)], 'READ', at, 0); // vượt 2 → bỏ bản cũ nhất
    expect(pending.take(id(1), 1000)).toBeUndefined();
    expect(pending.take(id(3), 1000)).toEqual({ status: 'READ', at });
    expect(pending.take(id(2), 61_000)).toBeUndefined(); // quá 60 s
  });

  it('trạng thái tin của mình: không receipt (GROUP) → SENT; deliveredAt → DELIVERED; readAt → READ', () => {
    expect(ownStatus(msg(id(1), '2026-10-28T10:00:00.000Z', { receipt: null }))).toBe('SENT');
    expect(ownStatus(msg(id(1), 'x', { receipt: { deliveredAt: 'x', readAt: null } }))).toBe('DELIVERED');
  });
});

describe('cửa sổ sửa / thu hồi theo giờ server (EC-MSG-012, EC-MSG-015)', () => {
  it('TC-MSG-012 đồng hồ máy lệch -10 phút: dùng ước lượng giờ server (median 5 mẫu) để ẩn "Sửa" sau 15 phút', () => {
    resetServerClockForTest();
    const local = Date.parse('2026-10-28T10:00:00.000Z');
    // server chạy trước máy 10 phút
    for (const d of [0, 1, 2, 3, 4]) recordServerTime(new Date(local + 600_000 + d).toISOString(), local);
    expect(Math.abs(serverNow(local) - (local + 600_002))).toBeLessThanOrEqual(2);
    const sentAt = new Date(local + 600_000 - 16 * 60_000).toISOString(); // 16 phút trước theo giờ server
    const m = msg(id(1), sentAt);
    expect(canEditOrRecall(m, ME, serverNow(local))).toBe(false);
    expect(
      canEditOrRecall({ ...m, createdAt: new Date(local + 600_000 - 60_000).toISOString() }, ME, serverNow(local)),
    ).toBe(true);
    expect(
      canEditOrRecall(
        { ...m, createdAt: new Date(local + 600_000 - 60_000).toISOString(), senderId: BOB },
        ME,
        serverNow(local),
      ),
    ).toBe(false);
  });
});
