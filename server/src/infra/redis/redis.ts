// server/src/infra/redis/redis.ts — ioredis client chính; cờ healthy theo event ready/error/end (kiến trúc §10.2)
import { Redis } from 'ioredis';
import { logger } from '../logger/logger';

export interface RedisHandle {
  client: Redis;
  isHealthy(): boolean;
  close(): Promise<void>;
}

export function createRedis(url: string): RedisHandle {
  let healthy = false;
  const client = new Redis(url, {
    lazyConnect: true,
    // Lệnh lỗi ngay khi mất kết nối thay vì xếp hàng → luồng phụ thuộc Redis trả SERVICE_UNAVAILABLE / fallback.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on('ready', () => {
    if (!healthy) logger.info({ dep: 'redis' }, 'redis ready');
    healthy = true;
  });
  client.on('error', (err: Error) => {
    if (healthy) logger.warn({ dep: 'redis', err: err.message }, 'redis error');
    healthy = false;
  });
  client.on('end', () => {
    healthy = false;
  });

  return {
    client,
    isHealthy: () => healthy && client.status === 'ready',
    close: async () => {
      healthy = false;
      if (client.status === 'end') return;
      await client.quit().catch(() => client.disconnect());
    },
  };
}

/** Kết nối lần đầu; Redis down lúc boot không làm process thoát (chat vẫn chạy, kiến trúc §10.2). */
export async function connectRedis(handle: RedisHandle, timeoutMs = 3000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    // connect() có thể chờ mãi trong lúc retryStrategy thử lại → giới hạn thời gian chờ lúc boot.
    await Promise.race([
      handle.client.connect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } catch (err) {
    logger.warn({ dep: 'redis', err: (err as Error).message }, 'redis chưa sẵn sàng lúc khởi động, sẽ tự thử lại');
  } finally {
    clearTimeout(timer);
  }
}
