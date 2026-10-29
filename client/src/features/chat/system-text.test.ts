import { describe, expect, it } from 'vitest';
import { systemText, type SystemView } from './system-text';

const me = { id: 'me', displayName: 'Alice' };
const bob = { id: 'b', displayName: 'Bob' };
const carol = { id: 'c', displayName: 'Carol' };
const base: SystemView = {
  kind: 'GROUP_CREATED',
  actor: bob,
  targets: [],
  targetCount: 0,
  title: null,
  role: null,
  callType: null,
  durationSec: null,
};

describe('systemText (FR-CHAT-011, ui_ux_spec.md §5.3)', () => {
  it.each([
    [{ kind: 'GROUP_CREATED' }, 'Bob đã tạo nhóm'],
    [{ kind: 'MEMBER_ADDED', targets: [me, carol], targetCount: 2 }, 'Bob đã thêm Bạn, Carol'],
    [{ kind: 'MEMBER_REMOVED', targets: [carol], targetCount: 1 }, 'Bob đã xóa Carol khỏi nhóm'],
    [{ kind: 'MEMBER_LEFT' }, 'Bob đã rời nhóm'],
    [{ kind: 'ROLE_CHANGED', targets: [carol], targetCount: 1, role: 'ADMIN' }, 'Bob đã đặt Carol làm quản trị viên'],
    [
      { kind: 'ROLE_CHANGED', targets: [carol], targetCount: 1, role: 'MEMBER' },
      'Bob đã gỡ quyền quản trị viên của Carol',
    ],
    [{ kind: 'OWNER_TRANSFERRED', targets: [me], targetCount: 1 }, 'Bob đã chuyển quyền trưởng nhóm cho Bạn'],
    [{ kind: 'TITLE_CHANGED', title: 'Nhóm mới' }, 'Bob đã đổi tên nhóm thành “Nhóm mới”'],
    [{ kind: 'CALL_MISSED', callType: 'VIDEO' }, 'Cuộc gọi video nhỡ'],
    [{ kind: 'CALL_ENDED', callType: 'VOICE', durationSec: 192 }, 'Cuộc gọi thoại · 03:12'],
  ] as const)('%o → %s', (over, text) => {
    expect(systemText({ ...base, ...over } as SystemView, me.id)).toBe(text);
  });

  it('actor là mình → "Bạn"', () => {
    expect(systemText({ ...base, actor: me }, me.id)).toBe('Bạn đã tạo nhóm');
  });

  it('quá 3 target → "{A}, {B}, {C} và {n} người khác"', () => {
    const t = [bob, carol, { id: 'd', displayName: 'Dan' }];
    expect(systemText({ ...base, actor: me, kind: 'MEMBER_ADDED', targets: t, targetCount: 5 }, me.id)).toBe(
      'Bạn đã thêm Bob, Carol, Dan và 2 người khác',
    );
  });
});
