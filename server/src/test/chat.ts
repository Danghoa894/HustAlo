// server/src/test/chat.ts — helper integration test M3: người dùng có phiên + socket, gửi event kèm envelope và chờ ACK.
import { randomUUID } from 'node:crypto';
import type { AckResponse } from '@hustalo/shared';
import type { Socket } from 'socket.io-client';
import { createUser, login, type Session, type TestServer } from './factories';
import { connectAs } from './socket-client';

export interface ChatUser {
  id: string;
  email: string;
  s: Session;
  sock: Socket;
}

/** Tạo user, đăng nhập và mở socket (đã kết nối). */
export async function chatUser(server: TestServer, username: string, opened: Socket[]): Promise<ChatUser> {
  const u = await createUser({ username, displayName: username });
  const s = await login(server, u.email);
  const sock = await connectAs(server.url, { token: s.accessToken, deviceId: s.deviceId });
  opened.push(sock);
  return { id: u.id, email: u.email, s, sock };
}

/** Mở thêm một socket (tab/thiết bị khác cùng phiên). */
export async function extraSocket(server: TestServer, s: Session, opened: Socket[]): Promise<Socket> {
  const sock = await connectAs(server.url, { token: s.accessToken, deviceId: s.deviceId });
  opened.push(sock);
  return sock;
}

export function emitAck<D = unknown>(sock: Socket, event: string, payload: unknown): Promise<AckResponse<D>> {
  return sock.timeout(5000).emitWithAck(event, { requestId: randomUUID(), payload }) as Promise<AckResponse<D>>;
}

/** Thu mọi event `event` nhận được trên socket (để khẳng định có/không có event). */
export function collect<T = Record<string, unknown>>(sock: Socket, event: string): T[] {
  const got: T[] = [];
  sock.on(event, (p: T) => got.push(p));
  return got;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
