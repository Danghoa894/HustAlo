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

/** Khóa ngày theo múi giờ trình duyệt (gom ngăn ngày trong phòng chat). */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Ngăn ngày phòng chat: "Hôm nay" / "Hôm qua" / "Thứ Hai, 20/10/2026" (ui_ux_spec.md §3.3). */
export function formatDayDivider(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (days === 0) return vi.chat.today;
  if (days === 1) return vi.chat.yesterday;
  const weekday = vi.chat.weekdaysLong[d.getDay()] ?? '';
  return `${weekday}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear())}`;
}

/** Giờ HH:mm của bubble. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Thời lượng mm:ss (CALL_ENDED). */
export function formatDuration(sec: number): string {
  return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
}

/** Đồng hồ trong cuộc gọi: mm:ss, từ 1 giờ: h:mm:ss (ui_ux_spec.md §3.7). */
export function formatCallClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 3600) return formatDuration(s);
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
