// client/src/features/calls/call-stats-hook.ts — window.__hustaloCallStats() để E2E đọc pc.getStats() qua page.evaluate
// (development_guide.md §6.6). Chỉ gắn khi import.meta.env.DEV: build production không có hook (Vite loại nhánh này).

declare global {
  interface Window {
    __hustaloCallStats?: () => Promise<RTCStats[]>;
  }
}

/** Gắn hook nếu là bản dev; trả về hàm gỡ (gọi khi call controller dừng). */
export function installCallStatsHook(getStats: () => Promise<RTCStats[]>): () => void {
  if (!import.meta.env.DEV) return () => undefined;
  window.__hustaloCallStats = getStats;
  return () => {
    if (window.__hustaloCallStats === getStats) delete window.__hustaloCallStats;
  };
}
