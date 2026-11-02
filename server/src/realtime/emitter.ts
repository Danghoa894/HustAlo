// server/src/realtime/emitter.ts — phát event S→C, tự gắn eventId (uuid) + occurredAt (kiến trúc §4.5)
// Service nhận emitter qua deps để unit test mock được (kiến trúc §5).
import { randomUUID } from 'node:crypto';
import type { ServerEventMeta, ServerToClientEvents } from '@hustalo/shared';
import type { Server } from 'socket.io';
import { convRoom, deviceRoom, presenceRoom, sessionRoom, tabRoom, userRoom } from './rooms';

export type ServerEventName = keyof ServerToClientEvents;
/** Omit phân phối qua union (payload như message:status có nhiều dạng theo `scope`). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ServerEventPayload<E extends ServerEventName> = DistributiveOmit<
  Parameters<ServerToClientEvents[E]>[0],
  keyof ServerEventMeta
>;

export interface Emitter {
  toRooms<E extends ServerEventName>(rooms: string | string[], event: E, payload: ServerEventPayload<E>): void;
  toUser<E extends ServerEventName>(userId: string, event: E, payload: ServerEventPayload<E>): void;
  toDevice<E extends ServerEventName>(deviceId: string, event: E, payload: ServerEventPayload<E>): void;
  toTab<E extends ServerEventName>(tabId: string, event: E, payload: ServerEventPayload<E>): void;
  toSession<E extends ServerEventName>(sid: string, event: E, payload: ServerEventPayload<E>): void;
  toConv<E extends ServerEventName>(conversationId: string, event: E, payload: ServerEventPayload<E>): void;
  toPresence<E extends ServerEventName>(userId: string, event: E, payload: ServerEventPayload<E>): void;
  /** Ngắt mọi socket trong room (sau khi đã phát event thu hồi phiên). */
  disconnect(rooms: string | string[]): void;
  /** Cho mọi socket trong `rooms` rời `room` (người bị xóa khỏi nhóm rời conv:{id}, FR-GROUP-003). */
  leaveRoom(rooms: string | string[], room: string): void;
  /** Phát tới user room trừ một tab (call:answered-elsewhere, kiến trúc §7(e)). */
  toUserExceptTab<E extends ServerEventName>(
    userId: string,
    tabId: string,
    event: E,
    payload: ServerEventPayload<E>,
  ): void;
  /**
   * Phát kèm ACK tới từng socket của user (call:incoming, T03); resolve true ngay khi socket ĐẦU TIÊN ACK, false khi
   * không có socket hoặc hết `timeoutMs` mà chưa ai ACK. Mỗi socket một lượt emit qua room riêng (socket.id) để ACK
   * từng tab về riêng, kể cả với adapter nhiều instance.
   */
  toUserFirstAck<E extends ServerEventName>(
    userId: string,
    event: E,
    payload: ServerEventPayload<E>,
    timeoutMs: number,
  ): Promise<boolean>;
  /** Socket đang ở room (qua adapter, đa instance): user + tab để thu hồi phiên chọn đúng tab cuộc gọi (T11, T27). */
  socketsIn(room: string): Promise<{ userId: string; tabId: string }[]>;
}

export function withMeta<P extends object>(payload: P, now: () => Date = () => new Date()): P & ServerEventMeta {
  return { eventId: randomUUID(), occurredAt: now().toISOString(), ...payload };
}

// Server có kiểu đầy đủ ở gateway; emitter chỉ cần phát theo tên room nên dùng Server không tham số.
export function createEmitter(io: Server): Emitter {
  const toRooms: Emitter['toRooms'] = (rooms, event, payload) => {
    io.to(rooms).emit(event, withMeta(payload));
  };
  return {
    toRooms,
    toUser: (id, e, p) => toRooms(userRoom(id), e, p),
    toDevice: (id, e, p) => toRooms(deviceRoom(id), e, p),
    toTab: (id, e, p) => toRooms(tabRoom(id), e, p),
    toSession: (id, e, p) => toRooms(sessionRoom(id), e, p),
    toConv: (id, e, p) => toRooms(convRoom(id), e, p),
    toPresence: (id, e, p) => toRooms(presenceRoom(id), e, p),
    disconnect: (rooms) => {
      io.in(rooms).disconnectSockets(true);
    },
    leaveRoom: (rooms, room) => {
      io.in(rooms).socketsLeave(room);
    },
    toUserExceptTab: (userId, tabId, event, payload) => {
      io.to(userRoom(userId)).except(tabRoom(tabId)).emit(event, withMeta(payload));
    },
    toUserFirstAck: async (userId, event, payload, timeoutMs) => {
      const sockets = await io.in(userRoom(userId)).fetchSockets();
      if (sockets.length === 0) return false;
      const data = withMeta(payload);
      return new Promise<boolean>((resolve) => {
        let pending = sockets.length;
        let done = false;
        for (const s of sockets) {
          io.to(s.id)
            .timeout(timeoutMs)
            .emit(event, data, (err: unknown, responses: unknown[] | undefined) => {
              pending -= 1;
              if (!done && !err && (responses?.length ?? 0) > 0) {
                done = true;
                resolve(true);
              } else if (!done && pending === 0) resolve(false);
            });
        }
      });
    },
    socketsIn: async (room) => {
      const sockets = await io.in(room).fetchSockets();
      return sockets.flatMap((s) => {
        const auth = (s.data as { auth?: { userId: string; tabId: string } }).auth;
        return auth ? [{ userId: auth.userId, tabId: auth.tabId }] : [];
      });
    },
  };
}
