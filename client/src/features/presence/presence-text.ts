// client/src/features/presence/presence-text.ts — chuỗi lastSeen (FR-PRES-002, ui_ux_spec.md §5.3) và typing
// (FR-CHAT-005: GROUP tối đa 2 tên, từ 3 người "Nhiều người đang soạn tin…").
import type { ConversationType } from '@hustalo/shared';
import { vi } from '../../i18n/vi';

const pad = (n: number) => String(n).padStart(2, '0');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `nowMs` theo giờ server ước lượng (server-clock.ts). */
export function formatLastSeen(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  const diff = Math.max(0, nowMs - t);
  if (diff < MINUTE) return vi.presence.justNow;
  if (diff < HOUR) return vi.presence.minutesAgo(Math.floor(diff / MINUTE));
  if (diff < DAY) return vi.presence.hoursAgo(Math.floor(diff / HOUR));
  const d = new Date(t);
  return vi.presence.at(`${pad(d.getHours())}:${pad(d.getMinutes())}`, `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`);
}

/** null khi không ai gõ. */
export function typingText(type: ConversationType, names: string[]): string | null {
  if (names.length === 0) return null;
  if (type !== 'GROUP') return vi.typing.direct;
  const [a = '', b = ''] = names;
  if (names.length === 1) return vi.typing.one(a);
  if (names.length === 2) return vi.typing.two(a, b);
  return vi.typing.many;
}
