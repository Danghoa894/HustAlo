// client/src/features/chat/useChatRuntime.ts — bật e2ee-runtime (M7), chat-runtime và presence-runtime khi đã đăng nhập
// (gắn ở RootLayout)
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/auth.store';
import { startE2eeRuntime } from '../e2ee/e2ee-runtime';
import { startPresenceRuntime } from '../presence/presence-runtime';
import { startChatRuntime } from './chat-runtime';

export function useChatRuntime(): void {
  const queryClient = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id ?? '');
  useEffect(() => {
    if (!meId) return;
    const stopE2ee = startE2eeRuntime({ meId });
    const stopChat = startChatRuntime({ queryClient, meId });
    const stopPresence = startPresenceRuntime();
    return () => {
      stopPresence();
      stopChat();
      stopE2ee();
    };
  }, [queryClient, meId]);
}
