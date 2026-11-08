// TC-MSG-018 — mở MessageActions không cần hover (ui_ux_spec.md §3.3 "Menu tin nhắn", §7 "Nhấn giữ bubble",
// EC-MSG-018): nhấn giữ 500 ms (hủy khi thả sớm / di chuyển > 10 px), chuột phải, Shift+F10 / ContextMenu.
import type { Message } from '@hustalo/shared';
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { MessageBubble } from './MessageBubble';

const ME = '6720a1b2c3d4e5f601234561';
const BOB = '6720a1b2c3d4e5f601234562';

function msg(senderId: string, over: Partial<Message> = {}): Message {
  return {
    id: '6720a1b2c3d4e5f601234601',
    conversationId: '6720a1b2c3d4e5f6012345aa',
    senderId,
    sender: { id: senderId, displayName: senderId === ME ? 'Alice' : 'Bob' },
    senderDeviceId: null,
    clientMessageId: null,
    type: 'TEXT',
    content: 'xin chào',
    ciphertext: null,
    system: null,
    receipt: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    editedAt: null,
    deletedAt: null,
    ...over,
  };
}

function renderBubble(m: Message) {
  render(
    <MessageBubble
      message={m}
      meId={ME}
      mine={m.senderId === ME}
      first
      last
      showName={false}
      status={null}
      editing={false}
      onEdit={() => undefined}
      onRecall={() => Promise.resolve(true)}
    />,
  );
  return screen.getByRole('article');
}

const menu = () => screen.queryByRole('menu', { name: t.chat.messageActions });
const touch = { pointerType: 'touch', pointerId: 1, isPrimary: true };

describe('TC-MSG-018 mở menu tin nhắn không cần hover (EC-MSG-018)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-MSG-018 nhấn giữ 500 ms trên bubble → mở menu "Sao chép" / "Sửa" / "Thu hồi"', () => {
    const bubble = renderBubble(msg(ME));
    fireEvent.pointerDown(bubble, { ...touch, clientX: 50, clientY: 50 });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(menu()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const opened = menu();
    expect(opened).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: t.chat.copy })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: t.chat.edit })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: t.chat.recall })).toBeInTheDocument();
    fireEvent.pointerUp(bubble, touch);
    expect(menu()).not.toBeNull(); // thả tay sau khi menu đã mở không đóng menu
  });

  it('TC-MSG-018 thả tay trước 500 ms → không mở', () => {
    const bubble = renderBubble(msg(ME));
    fireEvent.pointerDown(bubble, { ...touch, clientX: 50, clientY: 50 });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.pointerUp(bubble, touch);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menu()).toBeNull();
  });

  it('TC-MSG-018 ngón tay di chuyển > 10 px (đang cuộn) → hủy; ≤ 10 px vẫn mở', () => {
    const bubble = renderBubble(msg(ME));
    fireEvent.pointerDown(bubble, { ...touch, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(bubble, { ...touch, clientX: 50, clientY: 70 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menu()).toBeNull();

    fireEvent.pointerUp(bubble, touch);
    fireEvent.pointerDown(bubble, { ...touch, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(bubble, { ...touch, clientX: 56, clientY: 58 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(menu()).not.toBeNull();
  });

  it('TC-MSG-018 chuột phải → mở menu và chặn menu hệ thống', () => {
    const bubble = renderBubble(msg(BOB));
    const event = createEvent.contextMenu(bubble);
    fireEvent(bubble, event);
    expect(event.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: t.chat.copy })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: t.chat.edit })).toBeNull(); // tin của người khác
  });

  it('TC-MSG-018 Android: contextmenu đến trong lúc nhấn giữ → chỉ mở một lần, không bật menu hệ thống', () => {
    const bubble = renderBubble(msg(ME));
    fireEvent.pointerDown(bubble, { ...touch, clientX: 50, clientY: 50 });
    const early = createEvent.contextMenu(bubble);
    fireEvent(bubble, early); // Android phát contextmenu trước khi timer 500 ms chạy
    expect(early.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(600); // timer không mở lần hai
    });
    expect(screen.getAllByRole('menu', { name: t.chat.messageActions })).toHaveLength(1);
    const late = createEvent.contextMenu(bubble);
    fireEvent(bubble, late);
    expect(late.defaultPrevented).toBe(true);
    expect(screen.getAllByRole('menu', { name: t.chat.messageActions })).toHaveLength(1);
  });

  it('TC-MSG-018 Shift+F10 hoặc phím ContextMenu khi bubble focus → mở menu, focus mục đầu', () => {
    const bubble = renderBubble(msg(ME));
    bubble.focus();
    fireEvent.keyDown(bubble, { key: 'F10', shiftKey: true });
    expect(menu()).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: t.chat.copy })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(menu()).toBeNull();
    bubble.focus();
    fireEvent.keyDown(bubble, { key: 'ContextMenu' });
    expect(menu()).not.toBeNull();
  });

  it('TC-MSG-018 F10 không kèm Shift không mở menu', () => {
    const bubble = renderBubble(msg(ME));
    bubble.focus();
    fireEvent.keyDown(bubble, { key: 'F10' });
    expect(menu()).toBeNull();
  });

  it('TC-MSG-018 tin không có mục nào (của người khác, đã thu hồi) → không mở, không chặn hành vi mặc định', () => {
    const bubble = renderBubble(msg(BOB, { content: null, deletedAt: new Date().toISOString() }));
    const event = createEvent.contextMenu(bubble);
    fireEvent(bubble, event);
    expect(event.defaultPrevented).toBe(false);
    fireEvent.pointerDown(bubble, { ...touch, clientX: 50, clientY: 50 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menu()).toBeNull();
  });

  it('TC-MSG-018 bubble tắt chọn văn bản và menu hệ thống iOS khi nhấn giữ', () => {
    const bubble = renderBubble(msg(ME));
    expect(bubble.className).toContain('[-webkit-touch-callout:none]');
    fireEvent.pointerDown(bubble, { ...touch, clientX: 50, clientY: 50 });
    expect(bubble.className).toContain('select-none');
    fireEvent.pointerUp(bubble, touch);
    expect(bubble.className).not.toContain('select-none');
  });
});
