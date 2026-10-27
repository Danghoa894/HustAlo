// server/src/test/socket-client.ts — connectAs(url, token, deviceId) → socket.io-client đã kết nối, chờ event có timeout
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';

export interface ConnectOptions {
  token: string;
  deviceId: string;
  tabId?: string;
}

export function openSocket(url: string, opts: ConnectOptions): Socket {
  return io(url, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: { token: opts.token, deviceId: opts.deviceId, tabId: opts.tabId ?? randomUUID() },
  });
}

/** Kết nối thành công → socket; connect_error → reject với message (TOKEN_EXPIRED / UNAUTHENTICATED). */
export function connectAs(url: string, opts: ConnectOptions): Promise<Socket> {
  const socket = openSocket(url, opts);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err: Error) => {
      socket.close();
      reject(err);
    });
  });
}

export function connectError(url: string, opts: ConnectOptions): Promise<string> {
  return connectAs(url, opts).then(
    (s) => {
      s.close();
      throw new Error('Kỳ vọng connect_error nhưng kết nối thành công');
    },
    (err: Error) => err.message,
  );
}

export function waitFor<T = Record<string, unknown>>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Hết thời gian chờ event ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export function waitDisconnect(socket: Socket, timeoutMs = 5000): Promise<string> {
  if (socket.disconnected) return Promise.resolve('already');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Hết thời gian chờ disconnect')), timeoutMs);
    socket.once('disconnect', (reason: string) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}
