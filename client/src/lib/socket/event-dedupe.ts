// client/src/lib/socket/event-dedupe.ts — bỏ event trùng theo `eventId` (LRU CLIENT_EVENT_DEDUPE_SIZE; EC-NET-006)
import { CLIENT_EVENT_DEDUPE_SIZE } from '@hustalo/shared';

/** Trả hàm `seen(eventId)`: true nếu eventId đã gặp trong `size` event gần nhất. */
export function createEventDedupe(size: number = CLIENT_EVENT_DEDUPE_SIZE): (eventId: string) => boolean {
  const recent = new Set<string>();
  return (eventId) => {
    if (recent.has(eventId)) return true;
    recent.add(eventId);
    if (recent.size > size) {
      const oldest = recent.values().next().value;
      if (oldest !== undefined) recent.delete(oldest);
    }
    return false;
  };
}

/** Dedupe dùng chung cho toàn app (mọi listener event server). */
export const seenEvent = createEventDedupe();
