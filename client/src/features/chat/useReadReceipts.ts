// client/src/features/chat/useReadReceipts.ts — message:read cho tin mới nhất của người khác chỉ khi tab hiển thị +
// có focus + bubble đó nằm trong viewport ≥ 50% (EC-MSG-009, AC-042). Thiếu điều kiện → chờ visibilitychange / focus /
// IntersectionObserver. ACK ok → unreadCount của dòng danh sách.
import { EVENTS, type Message } from '@hustalo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { emitWithAck } from '../../lib/socket/emit';
import { useSocketStore } from '../../stores/socket.store';
import { patchSummary } from '../conversations/cache';

export const READ_VISIBLE_RATIO = 0.5;

export function useReadReceipts(conversationId: string, messages: readonly Message[], meId: string): void {
  const queryClient = useQueryClient();
  const connected = useSocketStore((s) => s.connectionState === 'connected');
  const sent = useRef<string | null>(null);
  const latest = messages.filter((m) => m.senderId !== meId).at(-1)?.id ?? null;

  useEffect(() => {
    if (!latest || !connected) return;
    // Không có IntersectionObserver (trình duyệt cũ, jsdom) → coi như bubble đang hiển thị.
    let inView = typeof IntersectionObserver === 'undefined';
    const send = () => {
      if (!inView || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      if (sent.current !== null && sent.current >= latest) return;
      sent.current = latest;
      emitWithAck(EVENTS.MESSAGE_READ, { conversationId, upToMessageId: latest })
        .then((res) => {
          if (res.ok) patchSummary(queryClient, conversationId, { unreadCount: res.data.unreadCount });
          else sent.current = null;
        })
        .catch(() => {
          sent.current = null;
        });
    };

    let observer: IntersectionObserver | null = null;
    const el = document.querySelector(`[data-message-id="${latest}"]`);
    if (!inView && el) {
      observer = new IntersectionObserver(
        (entries) => {
          inView = entries.some((e) => e.intersectionRatio >= READ_VISIBLE_RATIO);
          send();
        },
        { threshold: READ_VISIBLE_RATIO },
      );
      observer.observe(el);
    } else if (!el) {
      inView = true;
    }
    send();
    document.addEventListener('visibilitychange', send);
    window.addEventListener('focus', send);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', send);
      window.removeEventListener('focus', send);
    };
  }, [conversationId, latest, connected, queryClient]);
}
