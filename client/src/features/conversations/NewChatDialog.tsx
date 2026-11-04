// client/src/features/conversations/NewChatDialog.tsx — tìm người dùng → "Nhắn tin" (DIRECT) hoặc "Trò chuyện bí mật"
// (SECRET, M7); "Tạo nhóm" mở CreateGroupDialog (ui_ux_spec.md §3.2). Người nhận chưa có khóa (422
// E2EE_KEYS_UNAVAILABLE) → lỗi ngay trong hộp thoại "Người nhận chưa bật trò chuyện bí mật" + "Đóng" (§4.5, AC-112).
import { useId, useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { vi } from '../../i18n/vi';
import { UserRow } from './ConversationSearch';
import { useStartPair } from './useStartDirect';
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
  const [secretError, setSecretError] = useState(false);
  const start = useStartPair('DIRECT', onClose);
  const startSecret = useStartPair('SECRET', onClose, (code) => {
    if (code !== 'E2EE_KEYS_UNAVAILABLE') return false;
    setSecretError(true);
    return true;
  });
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
      {secretError ? (
        <div className="mb-3 overflow-hidden rounded-md">
          <Banner tone="danger">
            <span className="min-w-0 flex-1">{vi.e2ee.keysUnavailable}</span>
            <button
              type="button"
              className="min-h-[32px] px-2 underline"
              onClick={() => {
                setSecretError(false);
              }}
            >
              {vi.common.close}
            </button>
          </Banner>
        </div>
      ) : null}
      <ul role="list" className="max-h-80 overflow-y-auto">
        {users.map((u) => (
          <li key={u.id} className="py-1">
            <UserRow
              user={u}
              action={
                <span className="flex gap-2">
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
                  <Button
                    variant="secondary"
                    loading={startSecret.isPending && startSecret.variables === u.id}
                    aria-label={vi.conversations.secretChatWith(u.displayName)}
                    onClick={() => {
                      setSecretError(false);
                      startSecret.mutate(u.id);
                    }}
                  >
                    {vi.conversations.secretChat}
                  </Button>
                </span>
              }
            />
          </li>
        ))}
      </ul>
    </Modal>
  );
}
