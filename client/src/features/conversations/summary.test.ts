import type { ConversationSummary } from '@hustalo/shared';
import { describe, expect, it } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { conversationName, previewOf, rowLabel } from './summary';

const ME = '6720a1b2c3d4e5f601234561';
const BOB = '6720a1b2c3d4e5f601234562';
const summary = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: '6720a1b2c3d4e5f6012345aa',
  type: 'GROUP',
  title: 'Nhóm HUSTALO',
  avatarUrl: null,
  memberCount: 3,
  lastMessage: null,
  lastMessageAt: '2026-10-28T08:00:00.000Z',
  unreadCount: 0,
  myLastDeliveredMessageId: null,
  myLastReadMessageId: null,
  blockedByMe: false,
  canMessage: true,
  ...over,
});
const peer = { id: BOB, username: 'bob', displayName: 'Bob Trần', avatarUrl: null };
const systemLast = {
  id: '6720a1b2c3d4e5f6012345bb',
  senderId: ME,
  type: 'SYSTEM' as const,
  preview: null,
  createdAt: '2026-10-28T08:00:00.000Z',
  deletedAt: null,
  system: {
    kind: 'MEMBER_ADDED' as const,
    actor: { id: ME, displayName: 'Alice' },
    targets: [{ id: BOB, displayName: 'Bob Trần' }],
    targetCount: 1,
    title: null,
    role: null,
    callType: null,
    durationSec: null,
  },
};

describe('dòng danh sách chat (ui_ux_spec.md §3.2)', () => {
  it('tên: GROUP → title; DIRECT → peer.displayName', () => {
    expect(conversationName(summary())).toBe('Nhóm HUSTALO');
    expect(conversationName(summary({ type: 'DIRECT', title: null, peer }))).toBe('Bob Trần');
  });

  it('chưa có tin → "Chưa có tin nhắn"', () => {
    expect(previewOf(summary(), ME)).toBe(t.conversations.noMessages);
  });

  it('SYSTEM → chuỗi FR-CHAT-011 từ lastMessage.system, không tiền tố "Bạn: "', () => {
    expect(previewOf(summary({ lastMessage: systemLast }), ME)).toBe('Bạn đã thêm Bob Trần');
  });

  it('thu hồi → "Tin nhắn đã bị thu hồi" (có "Bạn: " nếu của mình); TEXT của mình có tiền tố "Bạn: "', () => {
    const text = { ...systemLast, type: 'TEXT' as const, system: null, preview: 'Hẹn mai nhé' };
    expect(previewOf(summary({ type: 'DIRECT', peer, lastMessage: text }), ME)).toBe('Bạn: Hẹn mai nhé');
    expect(previewOf(summary({ type: 'DIRECT', peer, lastMessage: { ...text, senderId: BOB } }), ME)).toBe(
      'Hẹn mai nhé',
    );
    const revoked = { ...text, preview: null, deletedAt: '2026-10-28T08:01:00.000Z' };
    expect(previewOf(summary({ type: 'DIRECT', peer, lastMessage: revoked }), ME)).toBe(
      `Bạn: ${t.conversations.revoked}`,
    );
  });

  it('bị chặn: blockedByMe → "Bạn đã chặn người này"; bị người kia chặn → "Không thể gửi tin nhắn tới người này"', () => {
    expect(previewOf(summary({ type: 'DIRECT', peer, canMessage: false, blockedByMe: true }), ME)).toBe(
      t.conversations.youBlocked,
    );
    expect(previewOf(summary({ type: 'DIRECT', peer, canMessage: false }), ME)).toBe(t.conversations.cannotMessage);
  });

  it('aria-label "{tên}, {n} tin chưa đọc, {preview}"; không chưa đọc thì bỏ phần đếm', () => {
    expect(rowLabel(summary({ unreadCount: 3 }), ME)).toBe('Nhóm HUSTALO, 3 tin chưa đọc, Chưa có tin nhắn');
    expect(rowLabel(summary(), ME)).toBe('Nhóm HUSTALO, Chưa có tin nhắn');
  });
});
