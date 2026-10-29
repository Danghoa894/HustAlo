// client/src/features/conversations/useConversationEvents.ts — event hội thoại → cache TanStack Query (ui_ux_spec.md §3):
// - conversation:updated → Q['conversation', id] = bản mới; tải lại danh sách (CREATED/TITLE/MEMBERS/ROLE/OWNER).
// - conversation:member-removed: mình bị xóa/rời → bỏ khỏi danh sách (phòng đang mở tự hiện modal);
//   người khác → tải lại Q['conversation', id] và danh sách.
// message:* (M3) bổ sung ở milestone sau.
import { EVENTS, type Conversation } from '@hustalo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { socket } from '../../lib/socket/socket';
import { useAuthStore } from '../../stores/auth.store';
import { dropFromList, syncConversation } from './cache';
import { conversationKeys } from './conversations.api';

export function useConversationEvents(): void {
  const queryClient = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id ?? '');

  useEffect(() => {
    const onUpdated = (p: { conversation: Conversation }) => {
      void syncConversation(queryClient, p.conversation);
    };
    const onRemoved = (p: { conversationId: string; userId: string }) => {
      if (p.userId === meId) {
        dropFromList(queryClient, p.conversationId);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: conversationKeys.one(p.conversationId) });
      void queryClient.invalidateQueries({ queryKey: conversationKeys.list });
    };
    socket.on(EVENTS.CONVERSATION_UPDATED, onUpdated);
    socket.on(EVENTS.CONVERSATION_MEMBER_REMOVED, onRemoved);
    return () => {
      socket.off(EVENTS.CONVERSATION_UPDATED, onUpdated);
      socket.off(EVENTS.CONVERSATION_MEMBER_REMOVED, onRemoved);
    };
  }, [queryClient, meId]);
}
