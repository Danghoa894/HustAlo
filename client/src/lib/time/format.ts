// client/src/lib/time/format.ts — định dạng giờ/ngày tiếng Việt (ui_ux_spec.md §3.2, §5.1 quy tắc 7)
import { vi } from '../../i18n/vi';

const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY_MS = 86_400_000;

/** Cột thời gian của dòng danh sách chat: HH:mm / "Hôm qua" / T2…CN (trong 7 ngày) / DD/MM / DD/MM/YYYY. */
export function formatListTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (days <= 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 1) return vi.conversations.yesterday;
  if (days < 7) return vi.conversations.weekdays[d.getDay()] ?? '';
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear())}`;
}

/** Thời lượng mm:ss (CALL_ENDED). */
export function formatDuration(sec: number): string {
  return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
}
