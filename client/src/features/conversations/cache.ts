// client/src/features/conversations/cache.ts — cập nhật cache TanStack Query sau thao tác/event hội thoại (ui_ux_spec.md §3)
import type { Conversation, ConversationPage, ConversationSummary } from '@hustalo/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { conversationKeys } from './conversations.api';

/** Q['conversation', id] = bản mới; danh sách tải lại (thứ tự/preview đổi theo SYSTEM mới). */
export async function syncConversation(queryClient: QueryClient, conv: Conversation): Promise<void> {
  queryClient.setQueryData(conversationKeys.one(conv.id), conv);
  await queryClient.invalidateQueries({ queryKey: conversationKeys.list });
}

/** Sửa một dòng danh sách đã tải (ví dụ unreadCount = 0 sau message:read). */
export function patchSummary(
  queryClient: QueryClient,
  conversationId: string,
  patch: Partial<ConversationSummary>,
): void {
  queryClient.setQueryData<InfiniteData<ConversationPage>>(conversationKeys.list, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((c) => (c.id === conversationId ? { ...c, ...patch } : c)),
          })),
        }
      : data,
  );
}

/** Dòng danh sách đã tải của một hội thoại (nếu có). */
export function findSummary(queryClient: QueryClient, conversationId: string): ConversationSummary | undefined {
  const data = queryClient.getQueryData<InfiniteData<ConversationPage>>(conversationKeys.list);
  for (const p of data?.pages ?? []) {
    const c = p.items.find((x) => x.id === conversationId);
    if (c) return c;
  }
  return undefined;
}

/** Bỏ hội thoại khỏi danh sách đã tải (rời nhóm / bị xóa khỏi nhóm). */
export function dropFromList(queryClient: QueryClient, conversationId: string): void {
  queryClient.setQueryData<InfiniteData<ConversationPage>>(conversationKeys.list, (data) =>
    data
      ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((c) => c.id !== conversationId) })) }
      : data,
  );
}
