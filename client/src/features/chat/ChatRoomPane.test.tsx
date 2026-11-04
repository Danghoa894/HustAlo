import { EVENTS, type Conversation, type ConversationPage } from '@hustalo/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { useSocketStore } from '../../stores/socket.store';
import { errorResponse, jsonResponse, userMe } from '../../test/fixtures';
import type { FakeSocket } from '../../test/fake-socket';
import { currentPath, renderPage, ROUTER_FUTURE } from '../../test/render';

const fake = vi.hoisted(() => ({ socket: null as unknown as FakeSocket }));
vi.mock('../../lib/socket/socket', async () => {
  const { FakeSocket: Fake } = await import('../../test/fake-socket');
  fake.socket = new Fake();
  return { socket: fake.socket, bindConnectionState: () => () => undefined };
});
const emitMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
vi.mock('../../lib/socket/emit', () => ({ emitWithAck: emitMock }));

const { ChatRoomPane } = await import('./ChatRoomPane');
const { useConversationEvents } = await import('../conversations/useConversationEvents');

const ME = userMe().id;
const CONV = '6720a1b2c3d4e5f6012345aa';
const group: Conversation = {
  id: CONV,
  type: 'GROUP',
  title: 'Dự án',
  createdBy: ME,
  memberCount: 3,
  members: [
    {
      userId: ME,
      user: { id: ME, username: 'alice', displayName: 'Alice', avatarUrl: null },
      role: 'MEMBER',
      joinedAt: '2026-10-01T00:00:00.000Z',
      lastDeliveredMessageId: null,
      lastReadMessageId: null,
    },
  ],
  lastMessageAt: '2026-10-28T00:00:00.000Z',
  blockedByMe: false,
  canMessage: true,
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
};

describe('ChatRoomPane (ui_ux_spec.md §2, §3.3)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true });
    useSocketStore.setState({ connectionState: 'connected' });
    emitMock.mockClear();
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  const open = (id: string) => renderPage(<ChatRoomPane />, { path: '/chats/:conversationId', at: `/chats/${id}` });

  it('TC-SEC-001 id không khớp ^[a-f0-9]{24}$ → "Không tìm thấy cuộc trò chuyện", không gọi API', () => {
    open('abc');
    expect(screen.getByRole('heading', { name: t.chat.roomNotFound })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('TC-SEC-001 API 404 → RoomNotFound; 403 NOT_A_MEMBER → "Bạn không còn là thành viên…"', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(404, 'NOT_FOUND'));
    const { unmount } = open(CONV);
    expect(await screen.findByRole('heading', { name: t.chat.roomNotFound })).toBeInTheDocument();
    unmount();
    fetchMock.mockResolvedValueOnce(errorResponse(403, 'NOT_A_MEMBER'));
    open(CONV);
    expect(await screen.findByRole('heading', { name: t.chat.notMember })).toBeInTheDocument();
  });

  it('nhóm: header tên + "{n} thành viên"; vào room bằng conversation:join khi đã kết nối', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, group));
    open(CONV);
    expect(await screen.findByRole('heading', { name: 'Dự án' })).toBeInTheDocument();
    expect(screen.getByText(t.chat.memberCount(3))).toBeInTheDocument();
    expect(emitMock).toHaveBeenCalledWith(EVENTS.CONVERSATION_JOIN, { conversationId: CONV });
  });

  it('EC-GROUP-007 bị xóa khi đang mở → modal "Bạn đã bị xóa khỏi nhóm {tên}" [Đóng] → /chats', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, group));
    open(CONV);
    await screen.findByRole('heading', { name: 'Dự án' });
    act(() => {
      fake.socket.emit(EVENTS.CONVERSATION_MEMBER_REMOVED, {
        conversationId: CONV,
        userId: ME,
        removedBy: '6720a1b2c3d4e5f601234562',
        reason: 'REMOVED',
      });
    });
    const dialog = screen.getByRole('dialog', { name: t.chat.removedFromGroup('Dự án') });
    fireEvent.click(screen.getByRole('button', { name: t.common.close }));
    expect(dialog).not.toBeInTheDocument();
    await waitFor(() => {
      expect(currentPath()).toBe('/chats');
    });
  });
});

describe('useConversationEvents', () => {
  function Probe() {
    useConversationEvents();
    return null;
  }

  it('conversation:updated → Q["conversation", id] mới; member-removed của mình → bỏ khỏi danh sách', async () => {
    useAuthStore.setState({ user: userMe() });
    const client = new QueryClient();
    const summary = { id: CONV } as ConversationPage['items'][number];
    client.setQueryData(['conversations'], { pages: [{ items: [summary], nextCursor: null }], pageParams: [null] });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter future={ROUTER_FUTURE}>
          <Routes>
            <Route path="*" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    act(() => {
      fake.socket.emit(EVENTS.CONVERSATION_UPDATED, { conversation: { ...group, title: 'Mới' }, change: 'TITLE' });
    });
    expect(client.getQueryData<Conversation>(['conversation', CONV])?.title).toBe('Mới');
    act(() => {
      fake.socket.emit(EVENTS.CONVERSATION_MEMBER_REMOVED, {
        conversationId: CONV,
        userId: ME,
        removedBy: ME,
        reason: 'LEFT',
      });
    });
    await waitFor(() => {
      const list = client.getQueryData<{ pages: ConversationPage[] }>(['conversations']);
      expect(list?.pages[0]?.items).toEqual([]);
    });
  });
});
