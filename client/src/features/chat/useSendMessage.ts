// client/src/features/chat/useSendMessage.ts — gửi qua outbox (FR-CHAT-006); outbox đầy → toast warning, nội dung
// giữ trong ô nhập (EC-MSG-007). Sửa/thu hồi: message:edit / message:delete; FORBIDDEN → toast hết hạn 15 phút.
import { EVENTS, normalizeMessageText } from '@hustalo/shared';
import type { AckResponse, Message } from '@hustalo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { errorMessage } from '../../i18n/errors';
import { vi } from '../../i18n/vi';
import { emitWithAck } from '../../lib/socket/emit';
import { useUiStore } from '../../stores/ui.store';
import { getOutbox } from './chat-runtime';
import { mergeIntoCache } from './messages.api';

/** `secretPeerId`: hội thoại SECRET → tin được mã hóa đầu-cuối lúc gửi (FR-E2EE-004). */
export function useSendMessage(conversationId: string, secretPeerId?: string) {
  const pushToast = useUiStore((s) => s.pushToast);
  return useCallback(
    async (raw: string): Promise<boolean> => {
      const outbox = getOutbox();
      if (!outbox) return false;
      const res = await outbox.enqueue(
        conversationId,
        normalizeMessageText(raw),
        secretPeerId ? { peerId: secretPeerId } : {},
      );
      if (res === 'FULL') {
        pushToast('warning', vi.chat.outboxFull);
        return false;
      }
      return true;
    },
    [conversationId, secretPeerId, pushToast],
  );
}

export function useMessageMutations(conversationId: string) {
  const queryClient = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const handle = useCallback(
    async (run: () => Promise<AckResponse<{ message: Message }>>): Promise<boolean> => {
      try {
        const res = await run();
        if (res.ok) {
          mergeIntoCache(queryClient, conversationId, [res.data.message]);
          return true;
        }
        pushToast('error', res.error.code === 'FORBIDDEN' ? vi.chat.editWindow : errorMessage(res.error.code));
      } catch {
        pushToast('error', errorMessage('SERVICE_UNAVAILABLE'));
      }
      return false;
    },
    [queryClient, conversationId, pushToast],
  );
  const edit = useCallback(
    (messageId: string, raw: string) =>
      handle(() => emitWithAck(EVENTS.MESSAGE_EDIT, { messageId, content: normalizeMessageText(raw) })),
    [handle],
  );
  const recall = useCallback(
    (messageId: string) => handle(() => emitWithAck(EVENTS.MESSAGE_DELETE, { messageId })),
    [handle],
  );
  return { edit, recall };
}
