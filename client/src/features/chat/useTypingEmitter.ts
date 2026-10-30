// client/src/features/chat/useTypingEmitter.ts — typing:start khi gõ, throttle TYPING_CLIENT_THROTTLE_MS (3 s);
// typing:stop khi gửi tin, xóa hết nội dung hoặc ô nhập mất focus (FR-CHAT-005, AC-026). Lỗi typing không hiển thị.
import { EVENTS, TYPING_CLIENT_THROTTLE_MS } from '@hustalo/shared';
import { useCallback, useEffect, useRef } from 'react';
import { emitWithAck } from '../../lib/socket/emit';
import { socket } from '../../lib/socket/socket';

export function useTypingEmitter(conversationId: string, now: () => number = () => Date.now()) {
  const lastStart = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (lastStart.current === null) return;
    lastStart.current = null;
    if (socket.connected) emitWithAck(EVENTS.TYPING_STOP, { conversationId }).catch(() => undefined);
  }, [conversationId]);

  const onInput = useCallback(
    (text: string) => {
      if (text.trim() === '') {
        stop();
        return;
      }
      const t = now();
      if (lastStart.current !== null && t - lastStart.current < TYPING_CLIENT_THROTTLE_MS) return;
      if (!socket.connected) return;
      lastStart.current = t;
      emitWithAck(EVENTS.TYPING_START, { conversationId }).catch(() => undefined);
    },
    [conversationId, now, stop],
  );

  // Rời phòng khi đang gõ → typing:stop.
  useEffect(() => stop, [stop]);

  return { onInput, stop };
}
