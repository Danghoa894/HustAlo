// client/src/features/chat/ChatRoomPane.tsx — khung phòng chat M2 (ui_ux_spec.md §2, §3.3):
// - id không khớp ^[a-f0-9]{24}$ hoặc 404 → RoomNotFound (EC-SEC-001); 403 NOT_A_MEMBER → "Bạn không còn là thành viên…".
// - Q['conversation', id]; vào room bằng conversation:join khi socket đã kết nối, rời bằng conversation:leave.
// - Bị xóa khỏi nhóm khi đang mở → modal "Bạn đã bị xóa khỏi nhóm {tên}" [Đóng] → /chats (EC-GROUP-007).
// - M3: MessageList + Composer (BlockedComposerNotice khi canMessage = false); phòng đang mở ghi vào chat.store để
//   sync sau reconnect; useReadReceipts gửi message:read khi tab hiển thị.
import { EVENTS, type Conversation, type Message } from '@hustalo/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { emitWithAck } from '../../lib/socket/emit';
import { socket } from '../../lib/socket/socket';
import { serverNow } from '../../lib/time/server-clock';
import { useAuthStore } from '../../stores/auth.store';
import { useChatStore } from '../../stores/chat.store';
import { useOutboxStore } from '../../stores/outbox.store';
import { useTypingStore } from '../../stores/typing.store';
import { useSocketStore } from '../../stores/socket.store';
import { findSummary } from '../conversations/cache';
import { conversationKeys, conversationsApi } from '../conversations/conversations.api';
import { useToggleBlock } from '../users/users.api';
import { BlockedComposerNotice } from './BlockedComposerNotice';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { TypingIndicator } from './TypingIndicator';
import { canEditOrRecall } from './message-state';
import { useMessages } from './useMessages';
import { useReadReceipts } from './useReadReceipts';
import { useMessageMutations, useSendMessage } from './useSendMessage';
import { ChatHeader, roomName } from './ChatHeader';
import { RoomNotFound } from './RoomNotFound';

export const CONVERSATION_ID_PATTERN = /^[a-f0-9]{24}$/;

function Room({ id }: { id: string }) {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const connected = useSocketStore((s) => s.connectionState === 'connected');
  const navigate = useNavigate();
  const [removedFrom, setRemovedFrom] = useState<string | null>(null);
  const q = useQuery({ queryKey: conversationKeys.one(id), queryFn: () => conversationsApi.get(id) });
  const title = q.data ? roomName(q.data, meId) : '';

  useEffect(() => {
    if (!connected) return;
    emitWithAck(EVENTS.CONVERSATION_JOIN, { conversationId: id })
      .then((res) => {
        // typingUserIds trong ACK: ai đang gõ lúc mở phòng (FR-CHAT-005)
        if (res.ok) for (const u of res.data.typingUserIds) useTypingStore.getState().setTyping(id, u, true);
      })
      .catch(() => undefined);
    return () => {
      emitWithAck(EVENTS.CONVERSATION_LEAVE, { conversationId: id }).catch(() => undefined);
    };
  }, [id, connected]);

  useEffect(() => {
    const onRemoved = (p: { conversationId: string; userId: string; reason: 'REMOVED' | 'LEFT' }) => {
      if (p.conversationId !== id || p.userId !== meId) return;
      if (p.reason === 'REMOVED') setRemovedFrom(title);
      else navigate('/chats', { replace: true });
    };
    socket.on(EVENTS.CONVERSATION_MEMBER_REMOVED, onRemoved);
    return () => {
      socket.off(EVENTS.CONVERSATION_MEMBER_REMOVED, onRemoved);
    };
  }, [id, meId, title, navigate]);

  if (removedFrom !== null) {
    return (
      <Modal
        open
        title={vi.chat.removedFromGroup(removedFrom)}
        onClose={() => {
          navigate('/chats', { replace: true });
        }}
        footer={
          <Button
            onClick={() => {
              navigate('/chats', { replace: true });
            }}
          >
            {vi.common.close}
          </Button>
        }
      >
        {null}
      </Modal>
    );
  }
  if (q.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label={vi.app.loading} />
      </div>
    );
  }
  if (q.isError) {
    const err = q.error;
    return <RoomNotFound notMember={err instanceof ApiError && err.code === 'NOT_A_MEMBER'} />;
  }
  return (
    <section aria-label={title} className="flex h-full flex-col">
      <ChatHeader conversation={q.data} />
      <RoomBody conversation={q.data} meId={meId} title={title} />
    </section>
  );
}

function RoomBody({ conversation, meId, title }: { conversation: Conversation; meId: string; title: string }) {
  const id = conversation.id;
  const queryClient = useQueryClient();
  const { query, loadOlder, loadingOlder, olderError } = useMessages(id);
  const send = useSendMessage(id);
  const { edit, recall } = useMessageMutations(id);
  const toggleBlock = useToggleBlock();
  const [editing, setEditing] = useState<Message | null>(null);
  // Cursor đọc lúc mở phòng: ngăn "Tin nhắn chưa đọc" đứng yên dù đọc tới đâu trong lúc đang mở.
  const [unreadAfterId] = useState(() => {
    const s = findSummary(queryClient, id);
    return s && s.unreadCount > 0 ? (s.myLastReadMessageId ?? '') : null;
  });
  const messages = query.data?.items ?? [];
  const hasPending = useOutboxStore((st) => st.items.some((i) => i.conversationId === id));
  useReadReceipts(id, messages, meId);

  useEffect(() => {
    useChatStore.getState().setOpenConversation(id);
    return () => {
      if (useChatStore.getState().openConversationId === id) useChatStore.getState().setOpenConversation(null);
    };
  }, [id]);

  const peer = conversation.members.find((m) => m.userId !== meId);
  const lastEditable =
    conversation.type === 'SECRET'
      ? null
      : (messages.filter((m) => m.senderId === meId && canEditOrRecall(m, meId, serverNow())).at(-1) ?? null);

  let body;
  if (query.isPending) {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner label={vi.app.loading} />
      </div>
    );
  } else if (query.isError) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-sm text-text-secondary">
        <span>{vi.chat.loadError}</span>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {vi.chat.retry}
        </Button>
      </div>
    );
  } else if (messages.length === 0 && !hasPending && conversation.type !== 'GROUP') {
    body = (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-text-secondary">
        <Avatar name={title} size={64} />
        <p className="text-base font-medium text-text">{title}</p>
        <p className="text-sm">{vi.chat.sayHello(title)}</p>
      </div>
    );
  } else {
    body = (
      <MessageList
        conversation={conversation}
        meId={meId}
        messages={messages}
        hasOlder={query.data.nextBefore !== null}
        loadingOlder={loadingOlder}
        olderError={olderError}
        unreadAfterId={unreadAfterId}
        editingId={editing?.id ?? null}
        onLoadOlder={loadOlder}
        onEdit={setEditing}
        onRecall={(m) => recall(m.id)}
      />
    );
  }

  return (
    <>
      {body}
      <TypingIndicator conversation={conversation} meId={meId} />
      {conversation.type !== 'GROUP' && !conversation.canMessage ? (
        <BlockedComposerNotice
          blockedByMe={conversation.blockedByMe}
          busy={toggleBlock.isPending}
          onUnblock={() => {
            if (peer) toggleBlock.mutate({ userId: peer.userId, block: false });
          }}
        />
      ) : (
        <Composer
          key={id}
          conversationId={id}
          editing={editing}
          lastEditable={lastEditable}
          onSend={send}
          onStartEdit={setEditing}
          onSaveEdit={(m, text) => edit(m.id, text)}
          onCancelEdit={() => {
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

export function ChatRoomPane() {
  const { conversationId = '' } = useParams();
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) return <RoomNotFound />;
  return <Room key={conversationId} id={conversationId} />;
}
