import { EVENTS, type Conversation, type Message, type MessagePage } from '@hustalo/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { useOutboxStore } from '../../stores/outbox.store';
import { useSocketStore } from '../../stores/socket.store';
import { useUiStore } from '../../stores/ui.store';
import { jsonResponse, urlOf, userMe } from '../../test/fixtures';
import type { FakeSocket } from '../../test/fake-socket';
import { renderPage } from '../../test/render';

const fake = vi.hoisted(() => ({ socket: null as unknown as FakeSocket }));
vi.mock('../../lib/socket/socket', async () => {
  const { FakeSocket: Fake } = await import('../../test/fake-socket');
  fake.socket = new Fake();
  return { socket: fake.socket, bindConnectionState: () => () => undefined };
});
type Ack = { ok: boolean; requestId?: string; data?: unknown; error?: { code: string; message: string } };
const emitMock = vi.hoisted(() => vi.fn<(event: string, payload: unknown) => Promise<Ack>>());
vi.mock('../../lib/socket/emit', () => ({ emitWithAck: emitMock }));

const { ChatRoomPane } = await import('./ChatRoomPane');
const { useChatRuntime } = await import('./useChatRuntime');

const ME = userMe().id;
const BOB = '6720a1b2c3d4e5f601234562';
const CONV = '6720a1b2c3d4e5f6012345aa';
const ref = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: null });

const direct = (over: Partial<Conversation> = {}): Conversation => ({
  id: CONV,
  type: 'DIRECT',
  title: null,
  createdBy: ME,
  memberCount: 2,
  members: [ME, BOB].map((userId) => ({
    userId,
    user: userId === ME ? ref(ME, 'Alice') : ref(BOB, 'Bob'),
    role: 'MEMBER' as const,
    joinedAt: '2026-10-01T00:00:00.000Z',
    lastDeliveredMessageId: null,
    lastReadMessageId: null,
  })),
  lastMessageAt: '2026-10-28T00:00:00.000Z',
  blockedByMe: false,
  canMessage: true,
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
  ...over,
});

let seq = 0;
function msg(senderId: string, over: Partial<Message> = {}): Message {
  seq += 1;
  return {
    id: `6720a1b2c3d4e5f6012346${String(seq).padStart(2, '0')}`,
    conversationId: CONV,
    senderId,
    sender: { id: senderId, displayName: senderId === ME ? 'Alice' : 'Bob' },
    senderDeviceId: null,
    clientMessageId: null,
    type: 'TEXT',
    content: 'xin chào',
    ciphertext: null,
    system: null,
    receipt: null,
    createdAt: new Date(Date.now() - 60_000 + seq * 1000).toISOString(),
    editedAt: null,
    deletedAt: null,
    ...over,
  };
}

function Room() {
  useChatRuntime();
  return <ChatRoomPane />;
}

describe('Phòng chat M3 (ui_ux_spec.md §3.3, §4.2)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let conv: Conversation;
  let page: MessagePage;
  let focusSpy: { mockRestore: () => void };

  beforeEach(() => {
    conv = direct();
    page = { items: [], nextBefore: null, nextAfter: null };
    fetchMock.mockImplementation((input) =>
      Promise.resolve(urlOf(input).includes('/messages') ? jsonResponse(200, page) : jsonResponse(200, conv)),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('indexedDB', undefined); // outbox trong RAM, mỗi test một bản mới
    focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true });
    useSocketStore.setState({ connectionState: 'connected' });
    useUiStore.setState({ toasts: [] });
    fake.socket.connected = true;
    emitMock.mockReset();
    emitMock.mockImplementation((event, payload) => {
      if (event === EVENTS.MESSAGE_SEND) {
        const p = payload as { clientMessageId: string; content: string };
        const m = msg(ME, { clientMessageId: p.clientMessageId, content: p.content });
        return Promise.resolve({ ok: true, data: { message: m, duplicate: false } });
      }
      if (event === EVENTS.MESSAGE_READ) return Promise.resolve({ ok: true, data: { advanced: true, unreadCount: 0 } });
      return Promise.resolve({ ok: true, data: {} });
    });
  });
  afterEach(() => {
    focusSpy.mockRestore();
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    useOutboxStore.setState({ items: [] });
  });

  const open = () => renderPage(<Room />, { path: '/chats/:conversationId', at: `/chats/${CONV}` });
  const composer = () => screen.findByRole('textbox', { name: t.chat.composerLabel });

  it('TC-AC-001 Enter gửi qua outbox → message:send {kind PLAINTEXT, clientMessageId}; ACK → bubble ✓ "Đã gửi"', async () => {
    open();
    const box = await composer();
    fireEvent.change(box, { target: { value: '  Chào Bob  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(
        EVENTS.MESSAGE_SEND,
        expect.objectContaining({ kind: 'PLAINTEXT', conversationId: CONV, content: 'Chào Bob' }),
      );
    });
    const log = screen.getByRole('log', { name: t.chat.messagesLog });
    expect(await within(log).findByText('Chào Bob')).toBeInTheDocument();
    expect(within(log).getByRole('img', { name: t.chat.status.SENT })).toBeInTheDocument();
    expect(box).toHaveValue('');
  });

  it('Shift+Enter và IME composition không gửi; nội dung rỗng → nút Gửi disabled (EC-MSG-001)', async () => {
    open();
    const box = await composer();
    expect(screen.getByRole('button', { name: t.chat.send })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'a' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(emitMock).not.toHaveBeenCalledWith(EVENTS.MESSAGE_SEND, expect.anything());
    fireEvent.change(box, { target: { value: '   \n ' } });
    expect(screen.getByRole('button', { name: t.chat.send })).toBeDisabled();
  });

  it('EC-MSG-002 bộ đếm khi còn ≤ 200 ký tự; > 4000 → màu danger, nút Gửi disabled', async () => {
    open();
    const box = await composer();
    fireEvent.change(box, { target: { value: 'x'.repeat(3900) } });
    expect(screen.getByText('3900/4000')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'x'.repeat(4001) } });
    expect(screen.getByText('4001/4000')).toHaveClass('text-danger');
    expect(screen.getByRole('button', { name: t.chat.send })).toBeDisabled();
  });

  it('EC-MSG-004 nội dung XSS hiển thị nguyên văn (React escape), thu hồi → "Tin nhắn đã bị thu hồi"', async () => {
    page = {
      items: [
        msg(BOB, { content: '<img src=x onerror=alert(1)>' }),
        msg(BOB, { content: null, deletedAt: new Date().toISOString() }),
      ],
      nextBefore: null,
      nextAfter: null,
    };
    open();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText(t.chat.revoked)).toBeInTheDocument();
    expect(screen.getByText(t.chat.startOfConversation)).toBeInTheDocument();
  });

  it('message:new từ người khác → hiện bubble, gửi message:delivered và message:read (tab hiển thị); trùng eventId bỏ qua', async () => {
    open();
    await composer();
    const m = msg(BOB, { content: 'Mai đi cafe không?' });
    const ev = { eventId: 'ev-1', occurredAt: new Date().toISOString(), message: m };
    act(() => {
      fake.socket.emit(EVENTS.MESSAGE_NEW, ev);
      fake.socket.emit(EVENTS.MESSAGE_NEW, ev);
    });
    expect(await screen.findAllByText('Mai đi cafe không?')).toHaveLength(1);
    await waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(EVENTS.MESSAGE_READ, { conversationId: CONV, upToMessageId: m.id });
    });
    const delivered = emitMock.mock.calls.filter(([e]) => e === EVENTS.MESSAGE_DELIVERED);
    expect(delivered).toEqual([[EVENTS.MESSAGE_DELIVERED, { conversationId: CONV, upToMessageId: m.id }]]);
    expect(useUiStore.getState().live.polite).toBe(t.chat.liveNewHere('Bob', 'Mai đi cafe không?'));
  });

  it('TC-MSG-009 tab ẩn → chỉ message:delivered, chưa message:read; tab hiện lại + focus → message:read', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    open();
    await composer();
    const m = msg(BOB, { content: 'tab ẩn' });
    act(() => {
      fake.socket.emit(EVENTS.MESSAGE_NEW, { eventId: 'ev-h', occurredAt: new Date().toISOString(), message: m });
    });
    await screen.findByText('tab ẩn');
    await waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(EVENTS.MESSAGE_DELIVERED, { conversationId: CONV, upToMessageId: m.id });
    });
    expect(emitMock).not.toHaveBeenCalledWith(EVENTS.MESSAGE_READ, expect.anything());
    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(EVENTS.MESSAGE_READ, { conversationId: CONV, upToMessageId: m.id });
    });
    visibility.mockRestore();
  });

  it('EC-MSG-008 message:status READ đến trước tin → áp khi tin tới (✓✓ "Đã xem")', async () => {
    open();
    await composer();
    const m = msg(ME, { content: 'tin của tôi' });
    act(() => {
      fake.socket.emit(EVENTS.MESSAGE_STATUS, {
        eventId: 'st-1',
        occurredAt: new Date().toISOString(),
        conversationId: CONV,
        scope: 'MESSAGE',
        messageIds: [m.id],
        status: 'READ',
        byUserId: BOB,
        at: new Date().toISOString(),
      });
      fake.socket.emit(EVENTS.MESSAGE_NEW, { eventId: 'ev-2', occurredAt: new Date().toISOString(), message: m });
    });
    expect(await screen.findByRole('img', { name: t.chat.status.READ })).toBeInTheDocument();
  });

  it('ACK USER_BLOCKED → FAILED chỉ có "Xóa"; ACK SERVICE_UNAVAILABLE → vẫn PENDING "Đang gửi"', async () => {
    emitMock.mockImplementation((event) =>
      Promise.resolve(
        event === EVENTS.MESSAGE_SEND
          ? { ok: false, error: { code: 'USER_BLOCKED', message: '' } }
          : { ok: true, data: {} },
      ),
    );
    open();
    const box = await composer();
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: t.chat.remove })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.chat.retry })).toBeNull();

    emitMock.mockImplementation((event) =>
      Promise.resolve(
        event === EVENTS.MESSAGE_SEND
          ? { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '' } }
          : { ok: true, data: {} },
      ),
    );
    fireEvent.change(box, { target: { value: 'lần hai' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByRole('img', { name: t.chat.status.PENDING })).toBeInTheDocument();
  });

  it('EC-MSG-011 DIRECT đã chặn → BlockedComposerNotice "Bạn đã chặn người này" + "Bỏ chặn" (DELETE /users/{id}/block)', async () => {
    conv = direct({ blockedByMe: true, canMessage: false });
    open();
    expect(await screen.findByText(t.chat.youBlocked)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: t.chat.composerLabel })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t.chat.unblock }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => urlOf(input).endsWith(`/users/${BOB}/block`) && init?.method === 'DELETE',
        ),
      ).toBe(true);
    });
  });

  it('phòng trống DIRECT → "Hãy gửi lời chào đến {tên}"', async () => {
    open();
    expect(await screen.findByText(t.chat.sayHello('Bob'))).toBeInTheDocument();
  });
});
