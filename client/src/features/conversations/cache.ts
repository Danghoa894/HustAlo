// client/src/features/conversations/cache.ts — cập nhật cache TanStack Query sau thao tác/event hội thoại (ui_ux_spec.md §3)
import type { Conversation, ConversationPage } from '@hustalo/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { conversationKeys } from './conversations.api';

/** Q['conversation', id] = bản mới; danh sách tải lại (thứ tự/preview đổi theo SYSTEM mới). */
export async function syncConversation(queryClient: QueryClient, conv: Conversation): Promise<void> {
  queryClient.setQueryData(conversationKeys.one(conv.id), conv);
  await queryClient.invalidateQueries({ queryKey: conversationKeys.list });
}

/** Bỏ hội thoại khỏi danh sách đã tải (rời nhóm / bị xóa khỏi nhóm). */
export function dropFromList(queryClient: QueryClient, conversationId: string): void {
  queryClient.setQueryData<InfiniteData<ConversationPage>>(conversationKeys.list, (data) =>
    data
      ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((c) => c.id !== conversationId) })) }
      : data,
  );
}
