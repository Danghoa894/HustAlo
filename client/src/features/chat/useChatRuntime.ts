// client/src/features/chat/useChatRuntime.ts — bật chat-runtime khi đã đăng nhập (gắn một lần ở ChatsLayout)
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/auth.store';
import { startChatRuntime } from './chat-runtime';

export function useChatRuntime(): void {
  const queryClient = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id ?? '');
  useEffect(() => {
    if (!meId) return;
    return startChatRuntime({ queryClient, meId });
  }, [queryClient, meId]);
}
