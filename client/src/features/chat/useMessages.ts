// client/src/features/chat/useMessages.ts — Q['messages', id]: trang mới nhất khi mở phòng, loadOlder() tải trang
// `before` (cursor, không skip — FR-CHAT-003). staleTime vô hạn: realtime + sync sau reconnect giữ cache mới.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { resolveSecretMessages } from '../e2ee/secret-messages';
import { mergeMessages } from './message-state';
import { messagesApi, messagesKey, type MessagesState } from './messages.api';

export function useMessages(conversationId: string) {
  const queryClient = useQueryClient();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const query = useQuery({
    queryKey: messagesKey(conversationId),
    queryFn: async (): Promise<MessagesState> => {
      const page = await messagesApi.page(conversationId);
      return { items: mergeMessages([], await resolveSecretMessages(page.items)), nextBefore: page.nextBefore };
    },
    staleTime: Infinity,
  });

  const loadOlder = useCallback(async () => {
    const state = queryClient.getQueryData<MessagesState>(messagesKey(conversationId));
    if (!state?.nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const page = await messagesApi.page(conversationId, { before: state.nextBefore });
      const items = await resolveSecretMessages(page.items);
      queryClient.setQueryData<MessagesState>(messagesKey(conversationId), (prev) =>
        prev ? { items: mergeMessages(prev.items, items), nextBefore: page.nextBefore } : prev,
      );
    } catch {
      setOlderError(true);
    } finally {
      setLoadingOlder(false);
    }
  }, [queryClient, conversationId, loadingOlder]);

  return { query, loadOlder, loadingOlder, olderError };
}
