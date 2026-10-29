// client/src/features/conversations/ChatListHeader.tsx — avatar → /settings/profile, "Trò chuyện mới", "Cài đặt" (ui_ux_spec.md §3.2)
import { Settings, SquarePen } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '../../components/ui/Avatar';
import { IconButton } from '../../components/ui/IconButton';
import { vi } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';

export function ChatListHeader({ onNewChat }: { onNewChat: () => void }) {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  return (
    <header className="flex items-center gap-2 px-4 pb-2 pt-[max(12px,var(--safe-top))]">
      <Link to="/settings/profile" className="hidden rounded-pill md:block">
        <Avatar name={user?.displayName ?? ''} size={40} />
        <span className="sr-only">{vi.settings.sections.profile}</span>
      </Link>
      <h1 className="flex-1 text-lg font-bold text-text">{vi.app.name}</h1>
      <IconButton
        label={vi.conversations.newChat}
        icon={<SquarePen size={20} aria-hidden="true" />}
        onClick={onNewChat}
      />
      <IconButton
        label={vi.conversations.settings}
        icon={<Settings size={20} aria-hidden="true" />}
        onClick={() => {
          navigate('/settings');
        }}
      />
    </header>
  );
}
