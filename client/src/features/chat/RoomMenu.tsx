// client/src/features/chat/RoomMenu.tsx — menu ⋯ của phòng chat (ui_ux_spec.md §3.3). GROUP (M2): "Quản lý thành viên",
// "Đổi tên nhóm" (OWNER/ADMIN, P11), "Rời nhóm". DIRECT (M3): "Chặn"/"Bỏ chặn" (FR-USER-004). SECRET ở M7.
import type { Conversation } from '@hustalo/shared';
import { useState } from 'react';
import { Menu, type MenuItem } from '../../components/ui/Menu';
import { vi } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { MemberManagerDialog } from '../groups/MemberManagerDialog';
import { RenameGroupDialog } from '../groups/RenameGroupDialog';
import { useLeaveGroup } from '../groups/useLeaveGroup';
import { useToggleBlock } from '../users/users.api';

export function RoomMenu({ conversation }: { conversation: Conversation }) {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const [dialog, setDialog] = useState<'members' | 'rename' | null>(null);
  const { requestLeave, dialog: leaveDialog } = useLeaveGroup(conversation);
  const toggleBlock = useToggleBlock();
  if (conversation.type === 'DIRECT') {
    const peerId = conversation.members.find((m) => m.userId !== meId)?.userId;
    if (!peerId) return null;
    const block = !conversation.blockedByMe;
    return (
      <Menu
        label={vi.chat.roomOptions}
        items={[
          {
            label: block ? vi.chat.block : vi.chat.unblock,
            danger: block,
            onSelect: () => {
              toggleBlock.mutate({ userId: peerId, block });
            },
          },
        ]}
      />
    );
  }
  if (conversation.type !== 'GROUP') return null;

  const myRole = conversation.members.find((m) => m.userId === meId)?.role ?? 'MEMBER';
  const items: MenuItem[] = [
    {
      label: vi.groups.manageMembers,
      onSelect: () => {
        setDialog('members');
      },
    },
    ...(myRole === 'MEMBER'
      ? []
      : [
          {
            label: vi.groups.rename,
            onSelect: () => {
              setDialog('rename');
            },
          },
        ]),
    { label: vi.groups.leave, danger: true, onSelect: requestLeave },
  ];

  return (
    <>
      <Menu label={vi.chat.roomOptions} items={items} />
      {dialog === 'members' ? (
        <MemberManagerDialog
          conversation={conversation}
          onClose={() => {
            setDialog(null);
          }}
          onLeave={() => {
            setDialog(null);
            requestLeave();
          }}
        />
      ) : null}
      {dialog === 'rename' ? (
        <RenameGroupDialog
          conversation={conversation}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {leaveDialog}
    </>
  );
}
