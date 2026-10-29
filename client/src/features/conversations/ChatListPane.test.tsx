import type { ConversationPage, ConversationSummary } from '@hustalo/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { errorResponse, jsonResponse, requestBody, urlOf, userMe } from '../../test/fixtures';
import { currentPath, renderPage } from '../../test/render';
import { ChatListPane } from './ChatListPane';

const ME = userMe().id;
const BOB = { id: '6720a1b2c3d4e5f601234562', username: 'bob', displayName: 'Bob Trần', avatarUrl: null };
const NEW_CONV = '6720a1b2c3d4e5f6012345cc';

const group = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: '6720a1b2c3d4e5f6012345aa',
  type: 'GROUP',
  title: 'Nhóm HUSTALO',
  avatarUrl: null,
  memberCount: 3,
  lastMessage: {
    id: '6720a1b2c3d4e5f6012345bb',
    senderId: ME,
    type: 'SYSTEM',
    preview: null,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    system: {
      kind: 'GROUP_CREATED',
      actor: { id: ME, displayName: 'Alice' },
      targets: [],
      targetCount: 0,
      title: null,
      role: null,
      callType: null,
      durationSec: null,
    },
  },
  lastMessageAt: new Date().toISOString(),
  unreadCount: 0,
  myLastDeliveredMessageId: null,
  myLastReadMessageId: null,
  blockedByMe: false,
  canMessage: true,
  ...over,
});

describe('ChatListPane (ui_ux_spec.md §3.2)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let page: ConversationPage;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true });
    useUiStore.setState({ toasts: [] });
    page = { items: [group()], nextCursor: null };
    fetchMock.mockImplementation((input, init) => {
      const url = urlOf(input);
      if (url.startsWith('/api/v1/conversations?')) return Promise.resolve(jsonResponse(200, page));
      if (url.startsWith('/api/v1/users/search')) return Promise.resolve(jsonResponse(200, { items: [BOB] }));
      if (url === '/api/v1/conversations' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(201, {
            conversation: {
              id: NEW_CONV,
              type: 'DIRECT',
              title: null,
              createdBy: ME,
              memberCount: 2,
              members: [],
              lastMessageAt: new Date().toISOString(),
              blockedByMe: false,
              canMessage: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            skipped: [],
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('dòng: tên nhóm, preview SYSTEM dựng chuỗi ("Bạn đã tạo nhóm"), aria-label đầy đủ, link /chats/:id', async () => {
    renderPage(<ChatListPane />, { path: '/chats' });
    const link = await screen.findByRole('link', { name: 'Nhóm HUSTALO, Bạn đã tạo nhóm' });
    expect(link).toHaveAttribute('href', '/chats/6720a1b2c3d4e5f6012345aa');
    expect(within(link).getByText('Bạn đã tạo nhóm')).toBeInTheDocument();
  });

  it('trống → "Chưa có cuộc trò chuyện nào" + "Bắt đầu trò chuyện" mở NewChatDialog', async () => {
    page = { items: [], nextCursor: null };
    renderPage(<ChatListPane />, { path: '/chats' });
    fireEvent.click(await screen.findByRole('button', { name: t.conversations.startChat }));
    expect(screen.getByRole('dialog', { name: t.conversations.newChat })).toBeInTheDocument();
  });

  it('lỗi tải → "Không tải được danh sách trò chuyện" + "Thử lại"', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(errorResponse(500, 'INTERNAL_ERROR')));
    renderPage(<ChatListPane />, { path: '/chats' });
    expect(await screen.findByText(t.conversations.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.common.retry }));
    expect(await screen.findByRole('link', { name: /Nhóm HUSTALO/ })).toBeInTheDocument();
  });

  it('tìm ≥ 2 ký tự → nhóm "Cuộc trò chuyện" (lọc bỏ dấu) và "Người dùng"; chọn người → POST DIRECT kèm Idempotency-Key → /chats/:id', async () => {
    renderPage(<ChatListPane />, { path: '/chats' });
    await screen.findByRole('link', { name: /Nhóm HUSTALO/ });
    fireEvent.change(screen.getByLabelText(t.conversations.search), { target: { value: 'nhom' } });
    const convs = await screen.findByRole('region', { name: t.conversations.sectionConversations });
    expect(within(convs).getByText('Nhóm HUSTALO')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t.conversations.search), { target: { value: 'bob' } });
    const usersSection = await screen.findByRole('region', { name: t.conversations.sectionUsers });
    fireEvent.click(within(usersSection).getByRole('button', { name: /Bob Trần/ }));
    await waitFor(() => {
      expect(currentPath()).toBe(`/chats/${NEW_CONV}`);
    });
    const i = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(requestBody(fetchMock, i)).toEqual({ type: 'DIRECT', memberIds: [BOB.id] });
    expect(new Headers(fetchMock.mock.calls[i]?.[1]?.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Esc trong ô tìm kiếm xóa nội dung', () => {
    renderPage(<ChatListPane />, { path: '/chats' });
    const input = screen.getByLabelText(t.conversations.search);
    fireEvent.change(input, { target: { value: 'bob' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
  });

  it('tạo DIRECT bị chặn → toast lỗi theo mã, không điều hướng', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = urlOf(input);
      if (url.startsWith('/api/v1/conversations?')) return Promise.resolve(jsonResponse(200, page));
      if (url.startsWith('/api/v1/users/search')) return Promise.resolve(jsonResponse(200, { items: [BOB] }));
      if (init?.method === 'POST') return Promise.resolve(errorResponse(403, 'USER_BLOCKED'));
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderPage(<ChatListPane />, { path: '/chats' });
    fireEvent.change(screen.getByLabelText(t.conversations.search), { target: { value: 'bob' } });
    const usersSection = await screen.findByRole('region', { name: t.conversations.sectionUsers });
    fireEvent.click(within(usersSection).getByRole('button', { name: /Bob Trần/ }));
    await waitFor(() => {
      expect(useUiStore.getState().toasts[0]?.tone).toBe('error');
    });
    expect(currentPath()).toBeNull();
  });
});
