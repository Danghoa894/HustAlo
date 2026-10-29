import type { Conversation, Member } from '@hustalo/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vi as t } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { errorResponse, jsonResponse, requestBody, urlOf, userMe } from '../../test/fixtures';
import { currentPath, renderPage } from '../../test/render';
import { RoomMenu } from '../chat/RoomMenu';
import { CreateGroupDialog } from './CreateGroupDialog';
import { addResultToasts } from './MemberManagerDialog';
import { actionsFor } from './MemberRow';

const ME = userMe().id;
const CONV = '6720a1b2c3d4e5f6012345aa';
const user = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: null });
const BOB = user('6720a1b2c3d4e5f601234562', 'Bob');
const CAROL = user('6720a1b2c3d4e5f601234563', 'Carol');
const member = (u: ReturnType<typeof user>, role: Member['role']): Member => ({
  userId: u.id,
  user: u,
  role,
  joinedAt: '2026-10-01T00:00:00.000Z',
  lastDeliveredMessageId: null,
  lastReadMessageId: null,
});
const conversation = (myRole: Member['role'], others: Member[] = [member(BOB, 'MEMBER')]): Conversation => ({
  id: CONV,
  type: 'GROUP',
  title: 'Dự án',
  createdBy: ME,
  memberCount: others.length + 1,
  members: [member(user(ME, 'Alice'), myRole), ...others],
  lastMessageAt: '2026-10-28T00:00:00.000Z',
  blockedByMe: false,
  canMessage: true,
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
});

describe('menu thành viên theo quyền (PRD §2 P13–P17, ui_ux_spec.md §3.4)', () => {
  it('TC-GROUP-005 OWNER/ADMIN/MEMBER thấy đúng thao tác; ADMIN không thấy thao tác với OWNER/ADMIN', () => {
    expect(actionsFor('OWNER', member(BOB, 'ADMIN'), ME)).toEqual(['REMOVE_ADMIN', 'TRANSFER', 'REMOVE']);
    expect(actionsFor('OWNER', member(BOB, 'MEMBER'), ME)).toEqual(['MAKE_ADMIN', 'TRANSFER', 'REMOVE']);
    expect(actionsFor('ADMIN', member(BOB, 'MEMBER'), ME)).toEqual(['REMOVE']);
    expect(actionsFor('ADMIN', member(BOB, 'OWNER'), ME)).toEqual([]);
    expect(actionsFor('ADMIN', member(BOB, 'ADMIN'), ME)).toEqual([]);
    expect(actionsFor('MEMBER', member(BOB, 'MEMBER'), ME)).toEqual([]);
    expect(actionsFor('OWNER', member(user(ME, 'Alice'), 'OWNER'), ME)).toEqual([]);
  });

  it('TC-GROUP-002 TC-GROUP-003 kết quả thêm: "Đã thêm {n} thành viên. {m} người đã có trong nhóm" + "Không thể thêm {tên}"', () => {
    const res = {
      added: [member(CAROL, 'MEMBER')],
      skipped: [
        { userId: BOB.id, code: 'CONFLICT' as const },
        { userId: '6720a1b2c3d4e5f601234569', code: 'USER_BLOCKED' as const },
      ],
    };
    expect(addResultToasts(res, new Map([['6720a1b2c3d4e5f601234569', 'Dave']]))).toEqual([
      { text: 'Đã thêm 1 thành viên. 1 người đã có trong nhóm', ok: true },
      { text: 'Không thể thêm Dave', ok: false },
    ]);
  });
});

describe('CreateGroupDialog (FR-GROUP-001)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true });
    useUiStore.setState({ toasts: [] });
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  async function fillAndPick() {
    fireEvent.change(screen.getByLabelText(t.groups.title), { target: { value: 'Dự án' } });
    expect(screen.getByText('5/100')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(t.groups.searchUsers), { target: { value: 'bo' } });
    fireEvent.click(await screen.findByRole('checkbox'));
    expect(screen.getByText(t.groups.selected(1, 99))).toBeInTheDocument();
  }

  it('TC-GROUP-001 422 CONVERSATION_FULL → lỗi trong dialog; thử lại dùng cùng Idempotency-Key', async () => {
    let posts = 0;
    fetchMock.mockImplementation((input, init) => {
      if (urlOf(input).startsWith('/api/v1/users/search')) return Promise.resolve(jsonResponse(200, { items: [BOB] }));
      if (init?.method === 'POST') {
        posts += 1;
        return Promise.resolve(errorResponse(422, 'CONVERSATION_FULL'));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderPage(<CreateGroupDialog onClose={() => undefined} />, { path: '/chats' });
    await fillAndPick();
    const submit = screen.getByRole('button', { name: t.groups.create });
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(t.groups.full);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(posts).toBe(2);
    });
    const keys = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('TC-GROUP-003 thành công: người bị bỏ qua → toast "Không thể thêm {tên}", điều hướng tới nhóm mới', async () => {
    fetchMock.mockImplementation((input, init) => {
      if (urlOf(input).startsWith('/api/v1/users/search')) return Promise.resolve(jsonResponse(200, { items: [BOB] }));
      if (init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(201, {
            conversation: conversation('OWNER', []),
            skipped: [{ userId: BOB.id, code: 'USER_BLOCKED' }],
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null }));
    });
    renderPage(<CreateGroupDialog onClose={() => undefined} />, { path: '/chats' });
    await fillAndPick();
    fireEvent.click(screen.getByRole('button', { name: t.groups.create }));
    await waitFor(() => {
      expect(currentPath()).toBe(`/chats/${CONV}`);
    });
    const i = fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'POST');
    expect(requestBody(fetchMock, i)).toEqual({ type: 'GROUP', title: 'Dự án', memberIds: [BOB.id] });
    expect(useUiStore.getState().toasts.map((x) => x.text)).toContain(t.groups.cannotAdd('Bob'));
  });
});

describe('RoomMenu — rời nhóm (FR-GROUP-004)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'tok', user: userMe(), bootstrapped: true });
    useUiStore.setState({ toasts: [] });
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE' ? new Response(null, { status: 204 }) : jsonResponse(200, conversation('ADMIN')),
      ),
    );
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  const openMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: t.chat.roomOptions }));
    return screen.getByRole('menu');
  };

  it('MEMBER: không có "Đổi tên nhóm"; "Rời nhóm" → xác nhận "Rời nhóm Dự án?" → DELETE members/me → /chats', async () => {
    renderPage(<RoomMenu conversation={conversation('MEMBER')} />, { path: '/chats/:id', at: `/chats/${CONV}` });
    const menu = openMenu();
    expect(within(menu).queryByRole('menuitem', { name: t.groups.rename })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: t.groups.leave }));
    const dialog = screen.getByRole('dialog', { name: t.groups.confirmLeave('Dự án') });
    fireEvent.click(within(dialog).getByRole('button', { name: t.groups.leave }));
    await waitFor(() => {
      expect(currentPath()).toBe('/chats');
    });
    expect(urlOf(fetchMock.mock.calls[0]?.[0])).toBe(`/api/v1/conversations/${CONV}/members/${ME}`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('TC-GROUP-004 OWNER còn thành viên → không gửi request, mở chọn trưởng nhóm mới; chọn → PATCH role OWNER rồi DELETE', async () => {
    renderPage(<RoomMenu conversation={conversation('OWNER', [member(BOB, 'MEMBER'), member(CAROL, 'ADMIN')])} />, {
      path: '/chats/:id',
      at: `/chats/${CONV}`,
    });
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: t.groups.leave }));
    const dialog = screen.getByRole('dialog', { name: t.groups.ownerMustTransfer });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Bob/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: t.groups.transfer }));
    await waitFor(() => {
      expect(currentPath()).toBe('/chats');
    });
    expect(fetchMock.mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${urlOf(u)}`)).toEqual([
      `PATCH /api/v1/conversations/${CONV}/members/${BOB.id}`,
      `DELETE /api/v1/conversations/${CONV}/members/${ME}`,
    ]);
    expect(requestBody(fetchMock, 0)).toEqual({ role: 'OWNER' });
  });

  it('409 khi rời → toast "Bạn cần chuyển quyền trưởng nhóm trước khi rời nhóm"', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(errorResponse(409, 'CONFLICT')));
    renderPage(<RoomMenu conversation={conversation('ADMIN')} />, { path: '/chats/:id', at: `/chats/${CONV}` });
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: t.groups.leave }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: t.groups.confirmLeave('Dự án') })).getByRole('button', {
        name: t.groups.leave,
      }),
    );
    await waitFor(() => {
      expect(useUiStore.getState().toasts[0]?.text).toBe(t.groups.ownerMustTransfer);
    });
  });

  it('Quản lý thành viên: OWNER thấy menu từng người; "Xóa khỏi nhóm" cần xác nhận "Xóa {tên} khỏi nhóm?"', async () => {
    renderPage(<RoomMenu conversation={conversation('OWNER')} />, { path: '/chats/:id', at: `/chats/${CONV}` });
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: t.groups.manageMembers }));
    const dialog = screen.getByRole('dialog', { name: t.groups.members(2) });
    expect(within(dialog).getByText(`Alice ${t.groups.you}`)).toBeInTheDocument();
    expect(within(dialog).getByText(t.groups.roles.OWNER)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: t.groups.memberActions('Bob') }));
    fireEvent.click(screen.getByRole('menuitem', { name: t.groups.removeMember }));
    const confirm = screen.getByRole('dialog', { name: t.groups.confirmRemove('Bob') });
    fireEvent.click(within(confirm).getByRole('button', { name: t.groups.remove }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u, init]) => init?.method === 'DELETE' && urlOf(u).endsWith(BOB.id))).toBe(
        true,
      );
    });
  });
});
