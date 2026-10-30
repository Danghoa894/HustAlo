// client/src/features/chat/useChatRuntime.ts — bật chat-runtime và presence-runtime khi đã đăng nhập (gắn ở RootLayout)
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/auth.store';
import { startPresenceRuntime } from '../presence/presence-runtime';
import { startChatRuntime } from './chat-runtime';

export function useChatRuntime(): void {
  const queryClient = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id ?? '');
  useEffect(() => {
    if (!meId) return;
    const stopChat = startChatRuntime({ queryClient, meId });
    const stopPresence = startPresenceRuntime();
    return () => {
      stopPresence();
      stopChat();
    };
  }, [queryClient, meId]);
}
