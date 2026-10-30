// client/src/features/chat/messages.api.ts — lịch sử tin (GET /conversations/{id}/messages) và cache Q['messages', id]
// (ui_ux_spec.md §3). Cache giữ một mảng tin tăng dần theo (createdAt, id) để hợp nhất event realtime và trang cũ.
import { HISTORY_PAGE_MAX, encodeCursor, type Message, type MessagePage } from '@hustalo/shared';
import type { QueryClient } from '@tanstack/react-query';
import { http } from '../../lib/api/http';
import { mergeMessages } from './message-state';

export interface MessagesState {
  items: Message[];
  nextBefore: string | null;
}

export const messagesKey = (conversationId: string) => ['messages', conversationId] as const;

export const messagesApi = {
  page: (conversationId: string, q: { before?: string; after?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (q.before) params.set('before', q.before);
    if (q.after) params.set('after', q.after);
    if (q.limit) params.set('limit', String(q.limit));
    const qs = params.toString();
    return http<MessagePage>(`/conversations/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ''}`);
  },
};

/** Hợp nhất tin vào cache nếu phòng đã được tải (chưa tải thì bỏ — mở phòng sẽ tải trang mới nhất). */
export function mergeIntoCache(queryClient: QueryClient, conversationId: string, incoming: Message[]): void {
  queryClient.setQueryData<MessagesState>(messagesKey(conversationId), (prev) =>
    prev ? { ...prev, items: mergeMessages(prev.items, incoming) } : prev,
  );
}

/** Sync sau reconnect (kiến trúc §7(c) bước 3): tải `after` tin mới nhất đã biết tới khi trang < limit. */
export async function fetchMissed(conversationId: string, newest: Message | undefined): Promise<Message[]> {
  if (!newest) return (await messagesApi.page(conversationId)).items;
  const out: Message[] = [];
  let after: string | null = encodeCursor({ createdAt: newest.createdAt, id: newest.id });
  while (after) {
    const page: MessagePage = await messagesApi.page(conversationId, { after, limit: HISTORY_PAGE_MAX });
    out.push(...page.items);
    after = page.nextAfter;
  }
  return out;
}
