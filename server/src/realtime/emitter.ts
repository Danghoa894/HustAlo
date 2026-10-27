// server/src/realtime/emitter.ts — phát event S→C, tự gắn eventId (uuid) + occurredAt (kiến trúc §4.5)
// Service nhận emitter qua deps để unit test mock được (kiến trúc §5).
import { randomUUID } from 'node:crypto';
import type { ServerEventMeta, ServerToClientEvents } from '@hustalo/shared';
import type { Server } from 'socket.io';
import { convRoom, deviceRoom, presenceRoom, sessionRoom, tabRoom, userRoom } from './rooms';

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<E extends ServerEventName> = Omit<
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
  };
}
