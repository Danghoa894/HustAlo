// client/src/features/conversations/conversations.api.ts — REST /conversations, /users/search (api_spec.yaml).
// Query key: ['conversations'] (infinite), ['conversation', id], ['users','search',q] (ui_ux_spec.md §3).
import { CONVERSATION_PAGE_DEFAULT } from '@hustalo/shared';
import type {
  AddMembersResponse,
  Conversation,
  ConversationPage,
  CreateConversationRequest,
  CreateConversationResponse,
  MemberRole,
  UserSearchResponse,
} from '@hustalo/shared';
import { http } from '../../lib/api/http';

export const conversationKeys = {
  list: ['conversations'] as const,
  one: (id: string) => ['conversation', id] as const,
  userSearch: (q: string) => ['users', 'search', q] as const,
};

/** staleTime của tìm kiếm người dùng (ui_ux_spec.md §3). */
export const USER_SEARCH_STALE_MS = 30_000;

const base = (id: string) => `/conversations/${encodeURIComponent(id)}`;

export const conversationsApi = {
  list: (cursor?: string | null) =>
    http<ConversationPage>(
      `/conversations?limit=${String(CONVERSATION_PAGE_DEFAULT)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  get: (id: string) => http<Conversation>(base(id)),
  /** Idempotency-Key sinh một lần cho mỗi ý định tạo (FR-CHAT-001, ui_ux_spec.md §3.4). */
  create: (body: CreateConversationRequest, idempotencyKey: string) =>
    http<CreateConversationResponse>('/conversations', {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  rename: (id: string, title: string) => http<Conversation>(base(id), { method: 'PATCH', body: { title } }),
  addMembers: (id: string, userIds: string[]) =>
    http<AddMembersResponse>(`${base(id)}/members`, { method: 'POST', body: { userIds } }),
  changeRole: (id: string, userId: string, role: MemberRole) =>
    http<Conversation>(`${base(id)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { role } }),
  removeMember: (id: string, userId: string) =>
    http<undefined>(`${base(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  searchUsers: (q: string) => http<UserSearchResponse>(`/users/search?q=${encodeURIComponent(q)}`),
};
