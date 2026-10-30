// client/src/features/chat/chat-runtime.ts — phần realtime của chat chạy suốt phiên (kiến trúc §7(b), §7(c)):
// - Outbox (IndexedDB) gửi message:send; ACK ok → hợp nhất tin vào Q['messages', id] (FR-CHAT-006).
// - message:new/edit/delete → cache (bỏ event trùng theo eventId, EC-NET-006); tin của người khác → message:delivered.
// - message:status MESSAGE → nâng receipt (không hạ cấp); id chưa có → giữ chờ (EC-MSG-008);
//   GROUP_AGGREGATE → cursor thành viên trong Q['conversation', id].
// - connect/reconnect → xả outbox + sync debounce (tải `after` cho phòng đang mở, bỏ cache phòng khác, tải lại
//   danh sách); máy thức dậy → sync; tab hiện lại / online → xả outbox (EC-NET-002/007/008/009).
import { EVENTS } from '@hustalo/shared';
import type { Conversation, Message, ServerToClientEvents } from '@hustalo/shared';
import type { QueryClient } from '@tanstack/react-query';
import { vi } from '../../i18n/vi';
import { Outbox } from '../../lib/outbox/outbox';
import { idbStorage, memoryStorage, type OutboxStorage } from '../../lib/outbox/outbox.db';
import { emitWithAck } from '../../lib/socket/emit';
import { seenEvent } from '../../lib/socket/event-dedupe';
import { socket } from '../../lib/socket/socket';
import { createSyncScheduler, watchResume } from '../../lib/socket/sync';
import { recordServerTime } from '../../lib/time/server-clock';
import { useChatStore } from '../../stores/chat.store';
import { useOutboxStore } from '../../stores/outbox.store';
import { useTypingStore } from '../../stores/typing.store';
import { useUiStore } from '../../stores/ui.store';
import { conversationKeys } from '../conversations/conversations.api';
import { PendingReceipts, applyStatus, withReceipt } from './message-state';
import { fetchMissed, mergeIntoCache, messagesKey, type MessagesState } from './messages.api';

const LIVE_PREVIEW_CHARS = 100;

type StatusPayload = Parameters<ServerToClientEvents[typeof EVENTS.MESSAGE_STATUS]>[0];

let current: Outbox | null = null;

/** Outbox của phiên hiện tại (null khi chưa đăng nhập). */
export const getOutbox = (): Outbox | null => current;

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

export interface ChatRuntimeOptions {
  queryClient: QueryClient;
  meId: string;
  storage?: OutboxStorage;
}

export function startChatRuntime({ queryClient, meId, storage }: ChatRuntimeOptions): () => void {
  const pending = new PendingReceipts();
  const listChanged = () => {
    void queryClient.invalidateQueries({ queryKey: conversationKeys.list });
  };

  const accept = (m: Message) => {
    const held = pending.take(m.id);
    mergeIntoCache(queryClient, m.conversationId, [held ? withReceipt(m, held.status, held.at) : m]);
    listChanged();
  };

  const delivered = (m: Message) => {
    if (m.senderId === meId) return;
    emitWithAck(EVENTS.MESSAGE_DELIVERED, { conversationId: m.conversationId, upToMessageId: m.id }).catch(
      () => undefined,
    );
  };

  const outbox = new Outbox({
    userId: meId,
    storage: storage ?? (hasIndexedDb() ? idbStorage() : memoryStorage()),
    send: (item) =>
      emitWithAck(EVENTS.MESSAGE_SEND, {
        kind: 'PLAINTEXT',
        conversationId: item.conversationId,
        clientMessageId: item.clientMessageId,
        content: item.content,
      }),
    isOnline: () => socket.connected,
    onSent: (_item, message) => {
      recordServerTime(message.createdAt);
      accept(message);
    },
    onFailed: (item, code) => {
      if (code === 'USER_BLOCKED' || code === 'NOT_A_MEMBER') {
        void queryClient.invalidateQueries({ queryKey: conversationKeys.one(item.conversationId) });
      }
    },
    onChange: (items) => {
      useOutboxStore.getState().setItems([...items]);
    },
  });
  current = outbox;
  void outbox
    .load()
    .then(() => {
      outbox.flush();
    })
    .catch(() => undefined);

  const sync = createSyncScheduler(async (isCurrent) => {
    const openId = useChatStore.getState().openConversationId;
    queryClient.removeQueries({
      queryKey: ['messages'],
      predicate: (q) => q.queryKey[1] !== openId,
    });
    listChanged();
    if (!openId) return;
    const state = queryClient.getQueryData<MessagesState>(messagesKey(openId));
    if (!state) return;
    const missed = await fetchMissed(openId, state.items.at(-1));
    if (!isCurrent() || missed.length === 0) return;
    mergeIntoCache(queryClient, openId, missed);
    const lastFromOther = missed.filter((m) => m.senderId !== meId).at(-1);
    if (lastFromOther) delivered(lastFromOther);
  });

  const onNew = (p: { eventId: string; occurredAt: string; message: Message }) => {
    if (seenEvent(p.eventId)) return;
    recordServerTime(p.occurredAt);
    accept(p.message);
    delivered(p.message);
    const m = p.message;
    useTypingStore.getState().setTyping(m.conversationId, m.senderId, false); // tin mới từ người đang gõ → ẩn
    if (m.senderId === meId || m.type !== 'TEXT') return;
    const ui = useUiStore.getState();
    if (useChatStore.getState().openConversationId === m.conversationId) {
      ui.announce(vi.chat.liveNewHere(m.sender.displayName, (m.content ?? '').slice(0, LIVE_PREVIEW_CHARS)));
    } else {
      ui.announce(vi.chat.liveNewElsewhere(m.sender.displayName));
    }
  };

  const onChanged = (p: { eventId: string; occurredAt: string; message: Message }) => {
    if (seenEvent(p.eventId)) return;
    recordServerTime(p.occurredAt);
    mergeIntoCache(queryClient, p.message.conversationId, [p.message]);
    listChanged();
  };

  const onStatus = (p: StatusPayload) => {
    if (seenEvent(p.eventId)) return;
    if (p.scope === 'MESSAGE') {
      queryClient.setQueryData<MessagesState>(messagesKey(p.conversationId), (prev) => {
        if (!prev) {
          pending.add(p.messageIds, p.status, p.at);
          return prev;
        }
        const { messages, unmatched } = applyStatus(prev.items, p);
        if (unmatched.length > 0) pending.add(unmatched, p.status, p.at);
        return { ...prev, items: messages };
      });
      return;
    }
    queryClient.setQueryData<Conversation>(conversationKeys.one(p.conversationId), (prev) =>
      prev
        ? {
            ...prev,
            members: prev.members.map((x) =>
              x.userId === p.userId
                ? { ...x, lastDeliveredMessageId: p.lastDeliveredMessageId, lastReadMessageId: p.lastReadMessageId }
                : x,
            ),
          }
        : prev,
    );
  };

  const onConnect = () => {
    outbox.flush();
    sync.trigger();
  };

  socket.on(EVENTS.MESSAGE_NEW, onNew);
  socket.on(EVENTS.MESSAGE_EDIT, onChanged);
  socket.on(EVENTS.MESSAGE_DELETE, onChanged);
  socket.on(EVENTS.MESSAGE_STATUS, onStatus);
  socket.on('connect', onConnect);
  const stopResume = watchResume({
    onWake: () => {
      sync.trigger();
    },
    onVisible: () => {
      outbox.flush();
    },
  });

  return () => {
    socket.off(EVENTS.MESSAGE_NEW, onNew);
    socket.off(EVENTS.MESSAGE_EDIT, onChanged);
    socket.off(EVENTS.MESSAGE_DELETE, onChanged);
    socket.off(EVENTS.MESSAGE_STATUS, onStatus);
    socket.off('connect', onConnect);
    stopResume();
    sync.dispose();
    outbox.dispose();
    if (current === outbox) current = null;
    useOutboxStore.getState().setItems([]);
  };
}
