// client/src/features/conversations/useStartDirect.ts — chọn người dùng → POST /conversations {type:'DIRECT'} → điều hướng
// (ui_ux_spec.md §3.2). Lỗi (USER_BLOCKED, NOT_FOUND…) → toast theo mã.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../i18n/errors';
import { ApiError } from '../../lib/api/http';
import { useUiStore } from '../../stores/ui.store';
import { conversationKeys, conversationsApi } from './conversations.api';

/**
 * DIRECT hoặc SECRET (M7, FR-E2EE-004). `onError` trả true = đã tự hiển thị lỗi (NewChatDialog hiện
 * "Người nhận chưa bật trò chuyện bí mật" ngay trong hộp thoại, ui_ux_spec.md §4.5); ngược lại toast theo mã.
 */
export function useStartPair(
  type: 'DIRECT' | 'SECRET',
  onDone?: () => void,
  onError?: (code: string | null) => boolean,
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  return useMutation({
    mutationFn: (userId: string) => conversationsApi.create({ type, memberIds: [userId] }, crypto.randomUUID()),
    onSuccess: async ({ conversation }) => {
      queryClient.setQueryData(conversationKeys.one(conversation.id), conversation);
      await queryClient.invalidateQueries({ queryKey: conversationKeys.list });
      onDone?.();
      navigate(`/chats/${conversation.id}`);
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : null;
      if (onError?.(code)) return;
      pushToast('error', errorMessage(code));
    },
  });
}

export const useStartDirect = (onDone?: () => void) => useStartPair('DIRECT', onDone);
