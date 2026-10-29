// client/src/features/chat/ChatRoomPane.tsx — khung phòng chat M2 (ui_ux_spec.md §2, §3.3):
// - id không khớp ^[a-f0-9]{24}$ hoặc 404 → RoomNotFound (EC-SEC-001); 403 NOT_A_MEMBER → "Bạn không còn là thành viên…".
// - Q['conversation', id]; vào room bằng conversation:join khi socket đã kết nối, rời bằng conversation:leave.
// - Bị xóa khỏi nhóm khi đang mở → modal "Bạn đã bị xóa khỏi nhóm {tên}" [Đóng] → /chats (EC-GROUP-007).
// MessageList, Composer (M3) gắn vào phần thân ở milestone sau.
import { EVENTS } from '@hustalo/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { vi } from '../../i18n/vi';
import { ApiError } from '../../lib/api/http';
import { emitWithAck } from '../../lib/socket/emit';
import { socket } from '../../lib/socket/socket';
import { useAuthStore } from '../../stores/auth.store';
import { useSocketStore } from '../../stores/socket.store';
import { conversationKeys, conversationsApi } from '../conversations/conversations.api';
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
    emitWithAck(EVENTS.CONVERSATION_JOIN, { conversationId: id }).catch(() => undefined);
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
      <div className="min-h-0 flex-1" />
    </section>
  );
}

export function ChatRoomPane() {
  const { conversationId = '' } = useParams();
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) return <RoomNotFound />;
  return <Room key={conversationId} id={conversationId} />;
}
