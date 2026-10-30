// client/src/features/presence/presence-runtime.ts — presence + typing realtime suốt phiên (FR-PRES-001..003, FR-CHAT-005):
// - presence:snapshot / presence:update → S.presence (bỏ event trùng theo eventId); typing:update → S.typing.
// - Danh sách người cần theo dõi (peer trong danh sách chat, header phòng) gom ở `wanted`; chỉ gửi presence:subscribe
//   cho id mới (rate limit presenceSubscribe 10/phút); connect/reconnect và đổi privacy → subscribe lại toàn bộ.
import { EVENTS, PRESENCE_SUBSCRIBE_MAX, type PresenceEntry } from '@hustalo/shared';
import { emitWithAck } from '../../lib/socket/emit';
import { seenEvent } from '../../lib/socket/event-dedupe';
import { socket } from '../../lib/socket/socket';
import { usePresenceStore } from '../../stores/presence.store';
import { useTypingStore } from '../../stores/typing.store';

const wanted = new Set<string>();
const sent = new Set<string>();

function send(ids: string[]): void {
  if (!socket.connected) return;
  for (let i = 0; i < ids.length; i += PRESENCE_SUBSCRIBE_MAX) {
    const chunk = ids.slice(i, i + PRESENCE_SUBSCRIBE_MAX);
    for (const id of chunk) sent.add(id);
    emitWithAck(EVENTS.PRESENCE_SUBSCRIBE, { userIds: chunk })
      .then((res) => {
        if (!res.ok) for (const id of chunk) sent.delete(id);
      })
      .catch(() => {
        for (const id of chunk) sent.delete(id);
      });
  }
}

/** Thêm người cần theo dõi; chỉ id chưa subscribe mới được gửi. */
export function watchPresence(ids: readonly string[]): void {
  for (const id of ids) wanted.add(id);
  send([...wanted].filter((id) => !sent.has(id)));
}

/** Subscribe lại toàn bộ (sau reconnect, sau khi đổi privacy.showLastSeen — kiến trúc §7(d)). */
export function resubscribePresence(): void {
  sent.clear();
  send([...wanted]);
}

export function startPresenceRuntime(): () => void {
  const onSnapshot = (p: { eventId: string; users: PresenceEntry[]; degraded: boolean }) => {
    if (seenEvent(p.eventId)) return;
    usePresenceStore.getState().applySnapshot(p.users, p.degraded);
  };
  const onUpdate = (p: { eventId: string } & PresenceEntry) => {
    if (seenEvent(p.eventId)) return;
    usePresenceStore.getState().applyUpdate({ userId: p.userId, status: p.status, lastSeenAt: p.lastSeenAt });
  };
  const onTyping = (p: { eventId: string; conversationId: string; userId: string; isTyping: boolean }) => {
    if (seenEvent(p.eventId)) return;
    useTypingStore.getState().setTyping(p.conversationId, p.userId, p.isTyping);
  };
  const onConnect = () => {
    resubscribePresence();
  };
  socket.on(EVENTS.PRESENCE_SNAPSHOT, onSnapshot);
  socket.on(EVENTS.PRESENCE_UPDATE, onUpdate);
  socket.on(EVENTS.TYPING_UPDATE, onTyping);
  socket.on('connect', onConnect);
  return () => {
    socket.off(EVENTS.PRESENCE_SNAPSHOT, onSnapshot);
    socket.off(EVENTS.PRESENCE_UPDATE, onUpdate);
    socket.off(EVENTS.TYPING_UPDATE, onTyping);
    socket.off('connect', onConnect);
    wanted.clear();
    sent.clear();
    usePresenceStore.getState().reset();
    useTypingStore.getState().reset();
  };
}
