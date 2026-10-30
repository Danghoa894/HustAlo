// client/src/features/chat/ChatHeader.tsx — header phòng chat (ui_ux_spec.md §3.3): ← (mobile), avatar, tên,
// dòng phụ "{n} thành viên" (GROUP) hoặc "Đang hoạt động" / lastSeen (DIRECT/SECRET, M4; degraded → không hiện);
// nút gọi (M5), E2eeBadge (M7) bổ sung theo milestone.
import type { Conversation } from '@hustalo/shared';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from '../../components/ui/Avatar';
import { vi } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { serverNow } from '../../lib/time/server-clock';
import { OnlineDot } from '../presence/OnlineDot';
import { formatLastSeen } from '../presence/presence-text';
import { usePresence, useWatchPresence } from '../presence/usePresence';
import { RoomMenu } from './RoomMenu';

function PresenceLine({ userId }: { userId: string | undefined }) {
  const p = usePresence(userId);
  if (!p) return null;
  if (p.status === 'ONLINE') return <p className="text-sm text-text-secondary">{vi.presence.online}</p>;
  if (!p.lastSeenAt) return null;
  return <p className="text-sm text-text-secondary">{formatLastSeen(p.lastSeenAt, serverNow())}</p>;
}

export function roomName(c: Conversation, meId: string): string {
  if (c.type === 'GROUP') return c.title ?? '';
  return c.members.find((m) => m.userId !== meId)?.user.displayName ?? '';
}

export function ChatHeader({ conversation }: { conversation: Conversation }) {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const name = roomName(conversation, meId);
  const peerId =
    conversation.type === 'GROUP' ? undefined : conversation.members.find((m) => m.userId !== meId)?.userId;
  useWatchPresence(peerId ? [peerId] : []);
  return (
    <header className="sticky top-0 z-sticky flex items-center gap-3 border-b border-border bg-surface-2 px-2 pb-2 pt-[max(8px,var(--safe-top))] md:px-4">
      <Link
        to="/chats"
        aria-label={vi.chat.backToList}
        className="inline-flex h-11 w-11 items-center justify-center rounded-pill hover:bg-surface-3 md:hidden"
      >
        <ArrowLeft size={20} aria-hidden="true" />
      </Link>
      <span className="relative shrink-0">
        <Avatar name={name} size={40} />
        <OnlineDot userId={peerId} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 dir="auto" className="truncate text-md font-semibold text-text" tabIndex={-1}>
          {name}
        </h2>
        {conversation.type === 'GROUP' ? (
          <p className="text-sm text-text-secondary">{vi.chat.memberCount(conversation.memberCount)}</p>
        ) : (
          <PresenceLine userId={peerId} />
        )}
      </div>
      <RoomMenu conversation={conversation} />
    </header>
  );
}
