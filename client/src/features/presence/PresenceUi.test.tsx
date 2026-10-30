import { EVENTS, TYPING_CLIENT_THROTTLE_MS, type Conversation, type MessagePage } from '@hustalo/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { usePresenceStore } from '../../stores/presence.store';
import { useSocketStore } from '../../stores/socket.store';
import { useTypingStore } from '../../stores/typing.store';
import { useUiStore } from '../../stores/ui.store';
import { errorResponse, jsonResponse, urlOf, userMe } from '../../test/fixtures';
import type { FakeSocket } from '../../test/fake-socket';
import { renderPage } from '../../test/render';

const fake = vi.hoisted(() => ({ socket: null as unknown as FakeSocket }));
vi.mock('../../lib/socket/socket', async () => {
  const { FakeSocket: Fake } = await import('../../test/fake-socket');
  fake.socket = new Fake();
  return { socket: fake.socket, bindConnectionState: () => () => undefined };
});
type Ack = { ok: boolean; data?: unknown; error?: { code: string; message: string } };
const emitMock = vi.hoisted(() => vi.fn<(event: string, payload: unknown) => Promise<Ack>>());
vi.mock('../../lib/socket/emit', () => ({ emitWithAck: emitMock }));

const { ChatRoomPane } = await import('../chat/ChatRoomPane');
const { useChatRuntime } = await import('../chat/useChatRuntime');
const { PrivacySection } = await import('../settings/PrivacySection');

const ME = userMe().id;
const BOB = '6720a1b2c3d4e5f601234562';
const CONV = '6720a1b2c3d4e5f6012345aa';
const ref = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: null });
const conv: Conversation = {
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
};
const page: MessagePage = { items: [], nextBefore: null, nextAfter: null };
let seq = 0;
const meta = () => ({ eventId: `ev-${String((seq += 1))}`, occurredAt: new Date().toISOString() });

function Room() {
  useChatRuntime();
  return <ChatRoomPane />;
}

describe('presence và typing trong phòng chat (FR-PRES-001..003, FR-CHAT-005)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(urlOf(input).includes('/messages') ? jsonResponse(200, page) : jsonResponse(200, conv)),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('indexedDB', undefined);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true });
    useSocketStore.setState({ connectionState: 'connected' });
    fake.socket.connected = true;
    emitMock.mockReset();
    emitMock.mockImplementation((event) =>
      Promise.resolve(
        event === EVENTS.CONVERSATION_JOIN
          ? { ok: true, data: { conversation: conv, unreadCount: 0, typingUserIds: [] } }
          : event === EVENTS.PRESENCE_SUBSCRIBE
            ? { ok: true, data: { accepted: [BOB] } }
            : event === EVENTS.MESSAGE_SEND
              ? { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '' } } // giữ trong outbox
              : { ok: true, data: {} },
      ),
    );
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const open = () => renderPage(<Room />, { path: '/chats/:conversationId', at: `/chats/${CONV}` });
  const header = () => screen.getByRole('banner');

  it('header subscribe peer; snapshot ONLINE → chấm "Đang hoạt động"; update OFFLINE + lastSeenAt → "Truy cập {n} phút trước"', async () => {
    open();
    await screen.findByRole('heading', { name: 'Bob' });
    await waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(EVENTS.PRESENCE_SUBSCRIBE, { userIds: [BOB] });
    });
    act(() => {
      fake.socket.emit(EVENTS.PRESENCE_SNAPSHOT, {
        ...meta(),
        degraded: false,
        users: [{ userId: BOB, status: 'ONLINE', lastSeenAt: null }],
      });
    });
    expect(screen.getByRole('img', { name: t.presence.online })).toBeInTheDocument();
    expect(header()).toHaveTextContent(t.presence.online);
    act(() => {
      fake.socket.emit(EVENTS.PRESENCE_UPDATE, {
        ...meta(),
        userId: BOB,
        status: 'OFFLINE',
        lastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      });
    });
    expect(screen.queryByRole('img', { name: t.presence.online })).toBeNull();
    expect(header()).toHaveTextContent('Truy cập 5 phút trước');
  });

  it('TC-PRES-005 snapshot degraded → không chấm online, không dòng lastSeen', async () => {
    open();
    await screen.findByRole('heading', { name: 'Bob' });
    act(() => {
      fake.socket.emit(EVENTS.PRESENCE_SNAPSHOT, {
        ...meta(),
        degraded: true,
        users: [{ userId: BOB, status: 'ONLINE', lastSeenAt: null }],
      });
    });
    expect(screen.queryByRole('img', { name: t.presence.online })).toBeNull();
    expect(header()).not.toHaveTextContent(t.presence.online);
  });

  it('typing:update → "đang soạn tin…"; tin mới từ người đó → ẩn ngay', async () => {
    open();
    await screen.findByRole('heading', { name: 'Bob' });
    act(() => {
      fake.socket.emit(EVENTS.TYPING_UPDATE, { ...meta(), conversationId: CONV, userId: BOB, isTyping: true });
    });
    expect(screen.getByText(t.typing.direct)).toBeInTheDocument();
    act(() => {
      fake.socket.emit(EVENTS.MESSAGE_NEW, {
        ...meta(),
        message: {
          id: '6720a1b2c3d4e5f601234699',
          conversationId: CONV,
          senderId: BOB,
          sender: { id: BOB, displayName: 'Bob' },
          senderDeviceId: null,
          clientMessageId: null,
          type: 'TEXT',
          content: 'xong',
          ciphertext: null,
          system: null,
          receipt: null,
          createdAt: new Date().toISOString(),
          editedAt: null,
          deletedAt: null,
        },
      });
    });
    expect(screen.queryByText(t.typing.direct)).toBeNull();
  });

  it('TC-AC-026 gõ liên tục 10 s → typing:start ≤ 4 lần (throttle 3 s); gửi tin → typing:stop', async () => {
    open();
    const box = await screen.findByRole('textbox', { name: t.chat.composerLabel });
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let ms = 0; ms <= 10_000; ms += 500) {
      vi.setSystemTime(new Date(1_700_000_000_000 + ms));
      fireEvent.change(box, { target: { value: `chữ ${String(ms)}` } });
    }
    const starts = emitMock.mock.calls.filter(([e]) => e === EVENTS.TYPING_START);
    expect(starts.length).toBeLessThanOrEqual(4);
    expect(starts.length).toBe(Math.floor(10_000 / TYPING_CLIENT_THROTTLE_MS) + 1);
    vi.useRealTimers();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(EVENTS.TYPING_STOP, { conversationId: CONV });
    });
  });

  it('xóa hết nội dung hoặc blur → typing:stop', async () => {
    open();
    const box = await screen.findByRole('textbox', { name: t.chat.composerLabel });
    fireEvent.change(box, { target: { value: 'a' } });
    fireEvent.change(box, { target: { value: '' } });
    expect(emitMock.mock.calls.filter(([e]) => e === EVENTS.TYPING_STOP)).toHaveLength(1);
    fireEvent.change(box, { target: { value: 'b' } });
    fireEvent.blur(box);
    expect(emitMock.mock.calls.filter(([e]) => e === EVENTS.TYPING_STOP)).toHaveLength(2);
  });
});

describe('PrivacySection (ui_ux_spec.md §3.8, FR-USER-004)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true });
    useUiStore.setState({ toasts: [] });
    usePresenceStore.getState().reset();
    useTypingStore.getState().reset();
    fake.socket.connected = true;
    emitMock.mockReset();
    emitMock.mockResolvedValue({ ok: true, data: { accepted: [] } });
    document.cookie = 'hustalo_csrf=csrf-9; path=/';
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  const toggle = () => screen.getByRole('switch', { name: new RegExp(t.settings.privacy.showLastSeen) });

  it('tắt switch → PATCH /users/me {privacy:{showLastSeen:false}} ngay, toast "Đã lưu thay đổi"', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, userMe({ privacy: { showLastSeen: false } })));
    renderPage(<PrivacySection />, { path: '/settings/privacy' });
    expect(toggle()).toBeChecked();
    expect(screen.getByText(t.settings.privacy.showLastSeenHint)).toBeInTheDocument();
    fireEvent.click(toggle());
    await waitFor(() => {
      expect(useUiStore.getState().toasts[0]?.text).toBe(t.settings.saved);
    });
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(urlOf(input)).toMatch(/\/users\/me$/);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ privacy: { showLastSeen: false } });
    expect(useAuthStore.getState().user?.privacy.showLastSeen).toBe(false);
    expect(toggle()).not.toBeChecked();
  });

  it('lỗi → switch trở về giá trị cũ + toast lỗi', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, 'INTERNAL_ERROR'));
    renderPage(<PrivacySection />, { path: '/settings/privacy' });
    fireEvent.click(toggle());
    await waitFor(() => {
      expect(useUiStore.getState().toasts[0]?.tone).toBe('error');
    });
    expect(toggle()).toBeChecked();
  });
});
