// server/src/realtime/gateway.ts — new Server(httpServer, opts kiến trúc §6.4), adapter, middleware, đăng ký handler
// M0: chỉ cấu hình + adapter + đếm kết nối. socket-auth và các handler được thêm từ M1.
import type { Server as HttpServer } from 'node:http';
import {
  SOCKET_MAX_PAYLOAD_BYTES,
  SOCKET_RECOVERY_MAX_DISCONNECT_MS,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@hustalo/shared';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { Server } from 'socket.io';
import { metrics } from '../infra/metrics/metrics';

export interface SocketAuth {
  userId: string;
  sid: string;
  deviceId: string;
  tabId: string;
}

export interface SocketData {
  auth?: SocketAuth;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Socket.IO InterServerEvents: chưa dùng event giữa các server
type InterServerEvents = {};

export type HustaloServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export interface GatewayOptions {
  path: string;
  pingInterval: number;
  pingTimeout: number;
  corsOrigins: readonly string[];
  adapter: 'memory' | 'redis-streams';
  redis?: Redis;
  logger: Logger;
}

export function createGateway(httpServer: HttpServer, opts: GatewayOptions): HustaloServer {
  const io: HustaloServer = new Server(httpServer, {
    path: opts.path,
    pingInterval: opts.pingInterval,
    pingTimeout: opts.pingTimeout,
    maxHttpBufferSize: SOCKET_MAX_PAYLOAD_BYTES,
    cors: { origin: [...opts.corsOrigins], credentials: true },
    transports: ['websocket', 'polling'],
    connectionStateRecovery: {
      maxDisconnectionDuration: SOCKET_RECOVERY_MAX_DISCONNECT_MS,
      skipMiddlewares: false, // D-14
    },
  });

  if (opts.adapter === 'redis-streams') {
    if (!opts.redis) throw new Error('SOCKET_ADAPTER=redis-streams cần Redis');
    io.adapter(createAdapter(opts.redis));
    opts.logger.info({ adapter: 'redis-streams' }, 'socket.io adapter');
  }

  io.on('connection', (socket) => {
    metrics.socketConnections.inc();
    socket.on('disconnect', () => {
      metrics.socketConnections.dec();
    });
  });

  return io;
}
