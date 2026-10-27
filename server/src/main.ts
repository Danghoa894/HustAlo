// server/src/main.ts — bootstrap: env → logger → key ring → mongo → redis → app → gateway → listen; SIGTERM (kiến trúc §10.3)
import { createServer } from 'node:http';
import { env } from './config/env';
import { createApp } from './app';
import { keyRing } from './infra/crypto/key-ring';
import { connectMongo, disconnectMongo, pingMongo } from './infra/db/mongo';
import { logger } from './infra/logger/logger';
import { metrics, startMetricsServer } from './infra/metrics/metrics';
import { connectRedis, createRedis } from './infra/redis/redis';
import { isMainModule } from './infra/runtime/is-main';
import { createGateway } from './realtime/gateway';

const HTTP_DRAIN_TIMEOUT_MS = 10_000;

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

  let draining = false;
  const app = createApp({
    logger,
    corsOrigins: env.CORS_ORIGINS,
    trustProxy: env.TRUST_PROXY,
    production: env.NODE_ENV === 'production',
    health: { pingMongo, isRedisHealthy: () => redis.isHealthy(), isDraining: () => draining },
  });
  const httpServer = createServer(app);
  const io = createGateway(httpServer, {
    path: env.SOCKET_PATH,
    pingInterval: env.SOCKET_PING_INTERVAL,
    pingTimeout: env.SOCKET_PING_TIMEOUT,
    corsOrigins: env.CORS_ORIGINS,
    adapter: env.SOCKET_ADAPTER,
    redis: redis.client,
    logger,
  });
  const metricsServer = await startMetricsServer(env.METRICS_PORT);
  const depTimer = setInterval(() => {
    void pingMongo().then((up) => metrics.dependencyUp.set({ dep: 'mongo' }, up ? 1 : 0));
    metrics.dependencyUp.set({ dep: 'redis' }, redis.isHealthy() ? 1 : 0);
  }, 5000);

  await new Promise<void>((resolve) => httpServer.listen(env.PORT, resolve));
  logger.info({ port: env.PORT, metricsPort: env.METRICS_PORT }, 'server listening');

  const shutdown = async (signal: string) => {
    if (draining) return;
    logger.info({ signal }, 'shutdown bắt đầu');
    draining = true; // (1) /health → 503 draining
    clearInterval(depTimer); // (2) dừng job nền (sweeper thêm ở M4/M5)
    // (3) ngừng nhận kết nối mới; (5) chờ request đang chạy tối đa 10 s
    const httpClosed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
    io.disconnectSockets(true); // (4) client reconnect sang instance khác / sau restart
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, HTTP_DRAIN_TIMEOUT_MS).unref());
    await Promise.race([httpClosed, timeout]);
    httpServer.closeAllConnections();
    metricsServer.close();
    // (6) đóng Mongo/Redis. Không kết thúc cuộc gọi (deadline nằm ở Redis).
    await Promise.allSettled([disconnectMongo(), redis.close()]);
    logger.info('shutdown xong');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (isMainModule(import.meta.url)) {
  await main();
}
