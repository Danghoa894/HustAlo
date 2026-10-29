// client/src/features/conversations/NewChatDialog.tsx — tìm người dùng → "Nhắn tin" (DIRECT); "Tạo nhóm" mở
// CreateGroupDialog. "Trò chuyện bí mật" ẩn tới M7 (ui_ux_spec.md §3.2).
import { useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { vi } from '../../i18n/vi';
import { UserRow } from './ConversationSearch';
import { useStartDirect } from './useStartDirect';
import { useUserSearch } from './useUserSearch';

export function NewChatDialog({
  open,
  onClose,
  onCreateGroup,
}: {
  open: boolean;
  onClose: () => void;
  onCreateGroup: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const { users } = useUserSearch(query);
  const start = useStartDirect(onClose);
  return (
    <Modal
      open={open}
      title={vi.conversations.newChat}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {vi.common.cancel}
          </Button>
          <Button onClick={onCreateGroup}>{vi.conversations.createGroup}</Button>
        </>
      }
    >
      <label htmlFor={inputId} className="sr-only">
        {vi.groups.searchUsers}
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        placeholder={vi.groups.searchUsers}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        className="mb-3 min-h-[44px] w-full rounded-md border border-border-strong bg-surface px-3 text-base text-text placeholder:text-text-secondary"
      />
      <ul role="list" className="max-h-80 overflow-y-auto">
        {users.map((u) => (
          <li key={u.id} className="py-1">
            <UserRow
              user={u}
              action={
                <Button
                  variant="secondary"
                  loading={start.isPending && start.variables === u.id}
                  aria-label={vi.conversations.messageTo(u.displayName)}
                  onClick={() => {
                    start.mutate(u.id);
                  }}
                >
                  {vi.conversations.message}
                </Button>
              }
            />
          </li>
        ))}
      </ul>
    </Modal>
  );
}
