// client/src/features/presence/usePresence.ts — theo dõi presence của các user đang hiển thị (FR-PRES-003) và đọc trạng
// thái từ S.presence. `degraded` → coi như không biết (không chấm online, không lastSeen — ui_ux_spec.md §4.1).
import type { PresenceEntry } from '@hustalo/shared';
import { useEffect } from 'react';
import { usePresenceStore } from '../../stores/presence.store';
import { watchPresence } from './presence-runtime';

/** Đăng ký theo dõi `ids` (id rỗng bị bỏ). */
export function useWatchPresence(ids: readonly string[]): void {
  const key = ids.filter(Boolean).join(',');
  useEffect(() => {
    if (key) watchPresence(key.split(','));
  }, [key]);
}

/** Trạng thái của `userId`; null khi chưa biết hoặc presence đang degraded. */
export function usePresence(userId: string | undefined): PresenceEntry | null {
  const entry = usePresenceStore((s) => (userId ? s.users[userId] : undefined));
  const degraded = usePresenceStore((s) => s.degraded);
  return degraded || !entry ? null : entry;
}
