// server/src/main.ts — bootstrap: env → logger → key ring → mongo → redis → app → gateway → listen; SIGTERM (kiến trúc §10.3)
// createRuntime() ghép mọi thành phần (dùng chung cho process thật và integration test).
import { createServer, type RequestListener, type Server as HttpServer } from 'node:http';
import type { Logger } from 'pino';
import { env } from './config/env';
import { createApp } from './app';
import { keyRing } from './infra/crypto/key-ring';
import { connectMongo, disconnectMongo, pingMongo } from './infra/db/mongo';
import { logger } from './infra/logger/logger';
import { metrics, startMetricsServer } from './infra/metrics/metrics';
import { createRateLimiters } from './infra/rate-limit/rate-limiter';
import { connectRedis, createRedis, type RedisHandle } from './infra/redis/redis';
import { isMainModule } from './infra/runtime/is-main';
import { createAuthRepository } from './modules/auth/auth.repository';
import { createAuthService, type AuthService } from './modules/auth/auth.service';
import { createConversationsService, type ConversationsService } from './modules/conversations/conversations.service';
import { createMessagesService, messagesCore, type MessagesService } from './modules/messages/messages.service';
import { createPresenceRepository } from './modules/presence/presence.repository';
import { createPresenceService, type PresenceService, type PresenceTiming } from './modules/presence/presence.service';
import { createTypingService } from './modules/presence/typing.service';
import { createReceiptsService } from './modules/messages/receipts.service';
import { usersService } from './modules/users/users.service';
import { createEmitter, type Emitter } from './realtime/emitter';
import { createGateway, type HustaloServer } from './realtime/gateway';
import { registerConversationHandlers } from './realtime/handlers/conversation.handler';
import { registerMessageHandlers } from './realtime/handlers/message.handler';
import { registerPresenceHandlers } from './realtime/handlers/presence.handler';
import { registerTypingHandlers } from './realtime/handlers/typing.handler';
import { createSessionNotifier, subscribeUserLocked } from './realtime/handlers/session.handler';

const HTTP_DRAIN_TIMEOUT_MS = 10_000;
const SUBSCRIBE_BOOT_TIMEOUT_MS = 3_000;

export interface Runtime {
  httpServer: HttpServer;
  io: HustaloServer;
  emitter: Emitter;
  auth: AuthService;
  conversations: ConversationsService;
  messages: MessagesService;
  presence: PresenceService;
  redis: RedisHandle;
  setDraining(v: boolean): void;
  close(): Promise<void>;
}

export interface RuntimeOptions {
  redis: RedisHandle;
  logger: Logger;
  /** Chỉ test: hook trong transaction gửi tin (TC-DB-007). */
  messageHooks?: { afterInsert?: () => Promise<void> };
  /** Chỉ test: rút ngắn lease/grace/heartbeat/sweep của presence. */
  presenceTiming?: Partial<PresenceTiming>;
}

export async function createRuntime(opts: RuntimeOptions): Promise<Runtime> {
  const { redis } = opts;
  let draining = false;

  // Thứ tự phá vòng phụ thuộc: http server → gateway (socket-auth chỉ cần repository) → emitter → service → app.
  // Listener 'request' phải có TRƯỚC khi Socket.IO attach: engine.io bọc các listener sẵn có và chỉ tự xử lý
  // /socket.io/*. Gắn Express sau sẽ làm request long-polling rơi vào Express (404) — EC-NET-010.
  let handleRequest: RequestListener = (_req, res) => {
    res.statusCode = 503;
    res.end();
  };
  const httpServer = createServer((req, res) => {
    handleRequest(req, res);
  });
  const authRepo = createAuthRepository(redis);
  const io = createGateway(httpServer, {
    path: env.SOCKET_PATH,
    pingInterval: env.SOCKET_PING_INTERVAL,
    pingTimeout: env.SOCKET_PING_TIMEOUT,
    corsOrigins: env.CORS_ORIGINS,
    adapter: env.SOCKET_ADAPTER,
    redis: redis.client,
    logger: opts.logger,
    auth: { isSessionRevoked: (sid) => authRepo.isRevoked(sid) },
  });
  const emitter = createEmitter(io);
  const auth = createAuthService({ repo: authRepo, notifier: createSessionNotifier(emitter) });
  const rateLimiters = createRateLimiters(redis.client);
  const conversations = createConversationsService({ emitter, users: usersService, messages: messagesCore, redis });
  const messages = createMessagesService({
    conversations,
    users: usersService,
    emitter,
    ...(opts.messageHooks ? { hooks: opts.messageHooks } : {}),
  });
  const receipts = createReceiptsService({ conversations, emitter });
  const presenceRepo = createPresenceRepository(redis.client);
  const presence = createPresenceService({
    repo: presenceRepo,
    users: usersService,
    conversations,
    emitter,
    isRedisHealthy: () => redis.isHealthy(),
    logger: opts.logger,
    ...(opts.presenceTiming ? { timing: opts.presenceTiming } : {}),
  });
  const typing = createTypingService({ repo: presenceRepo, conversations, users: usersService, emitter });
  registerPresenceHandlers(io, { presence, logger: opts.logger, rateLimiters });
  registerTypingHandlers(io, { typing, logger: opts.logger, rateLimiters });
  registerConversationHandlers(io, { conversations, typing, logger: opts.logger, rateLimiters });
  registerMessageHandlers(io, { messages, receipts, logger: opts.logger, rateLimiters });

  const app = createApp({
    logger: opts.logger,
    corsOrigins: env.CORS_ORIGINS,
    trustProxy: env.TRUST_PROXY,
    production: env.NODE_ENV === 'production',
    health: { pingMongo, isRedisHealthy: () => redis.isHealthy(), isDraining: () => draining },
    modules: { auth, users: usersService, conversations, messages, receipts, rateLimiters },
  });
  handleRequest = app;

  // Kết nối Redis riêng cho Pub/Sub (DG-03); Redis down lúc boot → thử lại theo retryStrategy.
  // duplicate() kế thừa lazyConnect + enableOfflineQueue=false của client chính → SUBSCRIBE bị từ chối ngay vì
  // kết nối chưa mở. Bật offline queue: SUBSCRIBE gửi khi kết nối sẵn sàng, ioredis tự subscribe lại sau reconnect.
  const subscriber = redis.client.duplicate({ lazyConnect: false, enableOfflineQueue: true });
  subscriber.on('error', () => {
    // Trạng thái Redis đã được client chính log (redis.ts); kết nối subscribe tự thử lại.
  });
  // Không chặn boot quá SUBSCRIBE_BOOT_TIMEOUT_MS khi Redis down; lệnh SUBSCRIBE vẫn nằm trong hàng đợi.
  const lockSub = await Promise.race([
    subscribeUserLocked(subscriber, emitter, opts.logger),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), SUBSCRIBE_BOOT_TIMEOUT_MS).unref();
    }),
  ]).catch((err: unknown) => {
    opts.logger.warn({ err: (err as Error).message }, 'chưa subscribe được ops:user-locked');
    return null;
  });

  presence.start();

  return {
    httpServer,
    io,
    emitter,
    auth,
    conversations,
    messages,
    presence,
    redis,
    setDraining: (v) => {
      draining = v;
    },
    close: async () => {
      presence.stop();
      await lockSub?.close();
      subscriber.disconnect();
      await io.close(); // đóng luôn httpServer
    },
  };
}

export async function main(): Promise<void> {
  // Fail-fast: key ring sai (keyId/độ dài) → thoát, lỗi không chứa giá trị key (AC-ARCH-004).
  try {
    keyRing.active();
  } catch (err) {
    logger.fatal({ err: (err as Error).message }, 'cấu hình khóa mã hóa không hợp lệ');
    process.exit(1);
  }

  try {
    await connectMongo(env.MONGODB_URI);
  } catch (err) {
    // AC-ARCH-003: standalone → "MongoDB phải chạy replica set (rs0) để dùng transaction".
    logger.fatal({ err: (err as Error).message }, (err as Error).message);
    process.exit(1);
  }

  const redis = createRedis(env.REDIS_URL);
  await connectRedis(redis);

  const runtime = await createRuntime({ redis, logger });
  const { httpServer, io } = runtime;
  const metricsServer = await startMetricsServer(env.METRICS_PORT);
  const depTimer = setInterval(() => {
    void pingMongo().then((up) => metrics.dependencyUp.set({ dep: 'mongo' }, up ? 1 : 0));
    metrics.dependencyUp.set({ dep: 'redis' }, redis.isHealthy() ? 1 : 0);
  }, 5000);

  await new Promise<void>((resolve) => httpServer.listen(env.PORT, resolve));
  logger.info({ port: env.PORT, metricsPort: env.METRICS_PORT }, 'server listening');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown bắt đầu');
    runtime.setDraining(true); // (1) /health → 503 draining
    clearInterval(depTimer); // (2) dừng job nền (sweeper thêm ở M4/M5)
    // (3) ngừng nhận kết nối mới; (5) chờ request đang chạy tối đa 10 s
    const httpClosed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
    io.disconnectSockets(true); // (4) client reconnect sang instance khác / sau restart
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, HTTP_DRAIN_TIMEOUT_MS).unref());
    await Promise.race([httpClosed, timeout]);
    httpServer.closeAllConnections();
    metricsServer.close();
    // (6) đóng Mongo/Redis. Không kết thúc cuộc gọi (deadline nằm ở Redis).
    await Promise.allSettled([runtime.close(), disconnectMongo(), redis.close()]);
    logger.info('shutdown xong');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (isMainModule(import.meta.url)) {
  await main();
}
