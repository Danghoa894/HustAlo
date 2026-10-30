// client/src/features/chat/system-text.ts — dựng chuỗi tin SYSTEM (FR-CHAT-011, ui_ux_spec.md §5.3).
// Dùng cho preview danh sách (lastMessage.system) và SystemMessage trong phòng chat (M3). Người hiện tại → "Bạn".
import type { Message, SystemPreview, UserRef } from '@hustalo/shared';
import { vi } from '../../i18n/vi';
import { formatDuration } from '../../lib/time/format';

export type SystemView = SystemPreview;

/** Tin SYSTEM trong phòng chat → SystemView (actor = sender của tin, đủ mọi target có tên). */
export function systemViewOf(m: Message): SystemView | null {
  const s = m.system;
  if (!s) return null;
  return {
    kind: s.kind,
    actor: m.sender,
    targets: s.targets,
    targetCount: s.targets.length,
    title: s.title,
    role: s.role,
    callType: s.callType,
    durationSec: s.durationSec,
  };
}

export function systemText(s: SystemView, meId: string): string {
  const name = (u: UserRef) => (u.id === meId ? vi.system.you : u.displayName);
  const actor = name(s.actor);
  const first = s.targets[0] ? name(s.targets[0]) : '';
  const listed = s.targets.map(name).join(', ');
  const targets =
    s.targetCount > s.targets.length ? vi.system.others(listed, s.targetCount - s.targets.length) : listed;
  switch (s.kind) {
    case 'GROUP_CREATED':
      return vi.system.GROUP_CREATED(actor);
    case 'MEMBER_ADDED':
      return vi.system.MEMBER_ADDED(actor, targets);
    case 'MEMBER_REMOVED':
      return vi.system.MEMBER_REMOVED(actor, first);
    case 'MEMBER_LEFT':
      return vi.system.MEMBER_LEFT(actor);
    case 'ROLE_CHANGED':
      return s.role === 'ADMIN' ? vi.system.ROLE_ADMIN(actor, first) : vi.system.ROLE_MEMBER(actor, first);
    case 'OWNER_TRANSFERRED':
      return vi.system.OWNER_TRANSFERRED(actor, first);
    case 'TITLE_CHANGED':
      return vi.system.TITLE_CHANGED(actor, s.title ?? '');
    case 'CALL_MISSED':
      return s.callType === 'VIDEO' ? vi.system.CALL_MISSED_VIDEO : vi.system.CALL_MISSED_VOICE;
    case 'CALL_ENDED': {
      const d = formatDuration(s.durationSec ?? 0);
      return s.callType === 'VIDEO' ? vi.system.CALL_ENDED_VIDEO(d) : vi.system.CALL_ENDED_VOICE(d);
    }
  }
}
