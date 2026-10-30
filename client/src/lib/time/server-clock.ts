// client/src/lib/time/server-clock.ts — ước lượng lệch giờ client ↔ server từ `occurredAt` / `createdAt` server
// (median 5 mẫu gần nhất; EC-MSG-012). Dùng để ẩn "Sửa"/"Thu hồi" sau 15 phút theo giờ server.
const MAX_SAMPLES = 5;
let offsets: number[] = [];

/** Ghi một mốc giờ server vừa nhận (event `occurredAt`, ACK `createdAt`). */
export function recordServerTime(iso: string, localNow: number = Date.now()): void {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return;
  offsets = [...offsets, t - localNow].slice(-MAX_SAMPLES);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Thời điểm hiện tại theo giờ server ước lượng (ms). */
export function serverNow(localNow: number = Date.now()): number {
  return localNow + median(offsets);
}

export function resetServerClockForTest(): void {
  offsets = [];
}
