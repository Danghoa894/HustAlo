// client/src/features/groups/TransferOwnerDialog.tsx — chọn trưởng nhóm mới (FR-GROUP-004, EC-GROUP-004, ui_ux_spec.md §3.4).
// Dùng khi OWNER rời nhóm còn thành viên khác: tiêu đề "Bạn cần chuyển quyền trưởng nhóm trước khi rời nhóm".
import type { Member } from '@hustalo/shared';
import { useState } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { vi } from '../../i18n/vi';

export function TransferOwnerDialog({
  title,
  candidates,
  loading = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  candidates: Member[];
  loading?: boolean;
  onConfirm: (userId: string) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <Modal
      open
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {vi.common.cancel}
          </Button>
          <Button
            loading={loading}
            disabled={chosen === null}
            onClick={() => {
              if (chosen) onConfirm(chosen);
            }}
          >
            {vi.groups.transfer}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="sr-only">{vi.groups.transferOwner}</legend>
        <ul role="list" className="max-h-80 overflow-y-auto">
          {candidates.map((m) => (
            <li key={m.userId}>
              <label className="flex min-h-[52px] cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="new-owner"
                  checked={chosen === m.userId}
                  onChange={() => {
                    setChosen(m.userId);
                  }}
                  className="h-5 w-5 accent-primary"
                />
                <Avatar name={m.user.displayName} size={40} />
                <span dir="auto" className="flex-1 truncate text-base text-text">
                  {m.user.displayName}
                </span>
                <span className="text-sm text-text-secondary">{vi.groups.roles[m.role]}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </Modal>
  );
}
