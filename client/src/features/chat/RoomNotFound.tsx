// client/src/features/chat/RoomNotFound.tsx — id sai / 404 → "Không tìm thấy cuộc trò chuyện" (EC-SEC-001);
// 403 NOT_A_MEMBER → "Bạn không còn là thành viên của cuộc trò chuyện này" (ui_ux_spec.md §2)
import { Link } from 'react-router-dom';
import { vi } from '../../i18n/vi';

export function RoomNotFound({ notMember = false }: { notMember?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-lg font-semibold text-text">{notMember ? vi.chat.notMember : vi.chat.roomNotFound}</h2>
      <Link to="/chats" className="font-medium text-primary underline">
        {vi.chat.backToList}
      </Link>
    </div>
  );
}
