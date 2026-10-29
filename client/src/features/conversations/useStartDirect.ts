// client/src/features/conversations/useStartDirect.ts — chọn người dùng → POST /conversations {type:'DIRECT'} → điều hướng
// (ui_ux_spec.md §3.2). Lỗi (USER_BLOCKED, NOT_FOUND…) → toast theo mã.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../i18n/errors';
import { ApiError } from '../../lib/api/http';
import { useUiStore } from '../../stores/ui.store';
import { conversationKeys, conversationsApi } from './conversations.api';

export function useStartDirect(onDone?: () => void) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  return useMutation({
    mutationFn: (userId: string) =>
      conversationsApi.create({ type: 'DIRECT', memberIds: [userId] }, crypto.randomUUID()),
    onSuccess: async ({ conversation }) => {
      queryClient.setQueryData(conversationKeys.one(conversation.id), conversation);
      await queryClient.invalidateQueries({ queryKey: conversationKeys.list });
      onDone?.();
      navigate(`/chats/${conversation.id}`);
    },
    onError: (err) => {
      pushToast('error', errorMessage(err instanceof ApiError ? err.code : null));
    },
  });
}
