// server/src/realtime/rooms.ts — tên room Socket.IO (kiến trúc §6.4). Không ghép chuỗi room ở nơi khác.
export const userRoom = (userId: string) => `user:${userId}`;
export const deviceRoom = (deviceId: string) => `device:${deviceId}`;
export const tabRoom = (tabId: string) => `tab:${tabId}`;
export const sessionRoom = (sid: string) => `session:${sid}`;
export const convRoom = (conversationId: string) => `conv:${conversationId}`;
export const presenceRoom = (userId: string) => `presence:${userId}`;
/** Người xem đã ẩn lastSeen của mình: presence:update tới room này luôn có lastSeenAt null (kiến trúc §7(d)). */
export const presenceNoLastSeenRoom = (userId: string) => `presence-nols:${userId}`;
