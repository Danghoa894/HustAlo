// client/src/features/groups/MemberRow.tsx — một thành viên: avatar, tên ("(Bạn)"), nhãn vai trò, menu theo quyền
// (PRD §2 P13–P17, ui_ux_spec.md §3.4): OWNER xem ADMIN: gỡ quyền / chuyển quyền / xóa; OWNER xem MEMBER: đặt quản trị
// viên / chuyển quyền / xóa; ADMIN xem MEMBER: xóa; còn lại không có menu (EC-GROUP-005).
import type { Member, MemberRole } from '@hustalo/shared';
import { Avatar } from '../../components/ui/Avatar';
import { Menu, type MenuItem } from '../../components/ui/Menu';
import { vi } from '../../i18n/vi';

export type MemberAction = 'MAKE_ADMIN' | 'REMOVE_ADMIN' | 'TRANSFER' | 'REMOVE';

export function actionsFor(myRole: MemberRole, target: Member, meId: string): MemberAction[] {
  if (target.userId === meId) return [];
  if (myRole === 'OWNER') {
    if (target.role === 'ADMIN') return ['REMOVE_ADMIN', 'TRANSFER', 'REMOVE'];
    if (target.role === 'MEMBER') return ['MAKE_ADMIN', 'TRANSFER', 'REMOVE'];
  }
  if (myRole === 'ADMIN' && target.role === 'MEMBER') return ['REMOVE'];
  return [];
}

const LABEL: Record<MemberAction, string> = {
  MAKE_ADMIN: vi.groups.makeAdmin,
  REMOVE_ADMIN: vi.groups.removeAdmin,
  TRANSFER: vi.groups.transferOwner,
  REMOVE: vi.groups.removeMember,
};

export function MemberRow({
  member,
  meId,
  myRole,
  onAction,
}: {
  member: Member;
  meId: string;
  myRole: MemberRole;
  onAction: (action: MemberAction, member: Member) => void;
}) {
  const items: MenuItem[] = actionsFor(myRole, member, meId).map((a) => ({
    label: LABEL[a],
    danger: a === 'REMOVE',
    onSelect: () => {
      onAction(a, member);
    },
  }));
  return (
    <li className="flex min-h-[56px] items-center gap-3">
      <Avatar name={member.user.displayName} size={40} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-base text-text">
          {member.user.displayName}
          {member.userId === meId ? ` ${vi.groups.you}` : ''}
        </span>
        <span className="text-sm text-text-secondary">{vi.groups.roles[member.role]}</span>
      </span>
      <Menu label={vi.groups.memberActions(member.user.displayName)} items={items} />
    </li>
  );
}
