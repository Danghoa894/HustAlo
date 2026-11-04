// client/src/features/chat/RoomMenu.tsx — menu ⋯ của phòng chat (ui_ux_spec.md §3.3). GROUP (M2): "Quản lý thành viên",
// "Đổi tên nhóm" (OWNER/ADMIN, P11), "Rời nhóm". DIRECT (M3): "Chặn"/"Bỏ chặn" (FR-USER-004), "Trò chuyện bí mật" (M7);
// SECRET (M7): "Xác minh mã an toàn" → SafetyNumberDialog.
import type { Conversation } from '@hustalo/shared';
import { useState } from 'react';
import { Menu, type MenuItem } from '../../components/ui/Menu';
import { vi } from '../../i18n/vi';
import { useAuthStore } from '../../stores/auth.store';
import { MemberManagerDialog } from '../groups/MemberManagerDialog';
import { RenameGroupDialog } from '../groups/RenameGroupDialog';
import { useLeaveGroup } from '../groups/useLeaveGroup';
import { useStartPair } from '../conversations/useStartDirect';
import { useToggleBlock } from '../users/users.api';

export function RoomMenu({
  conversation,
  onVerifySafetyNumber,
}: {
  conversation: Conversation;
  onVerifySafetyNumber?: () => void;
}) {
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const [dialog, setDialog] = useState<'members' | 'rename' | null>(null);
  const { requestLeave, dialog: leaveDialog } = useLeaveGroup(conversation);
  const toggleBlock = useToggleBlock();
  const startSecret = useStartPair('SECRET');
  if (conversation.type === 'DIRECT' || conversation.type === 'SECRET') {
    const peerId = conversation.members.find((m) => m.userId !== meId)?.userId;
    if (!peerId) return null;
    const block = !conversation.blockedByMe;
    const items: MenuItem[] =
      conversation.type === 'DIRECT'
        ? [
            {
              label: vi.e2ee.secretChat,
              onSelect: () => {
                startSecret.mutate(peerId);
              },
            },
          ]
        : onVerifySafetyNumber
          ? [{ label: vi.e2ee.verifySafetyNumber, onSelect: onVerifySafetyNumber }]
          : [];
    if (conversation.type === 'DIRECT') {
      items.push({
        label: block ? vi.chat.block : vi.chat.unblock,
        danger: block,
        onSelect: () => {
          toggleBlock.mutate({ userId: peerId, block });
        },
      });
    }
    if (items.length === 0) return null;
    return <Menu label={vi.chat.roomOptions} items={items} />;
  }

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
