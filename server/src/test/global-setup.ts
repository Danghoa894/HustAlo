// server/src/test/global-setup.ts — MongoMemoryReplSet 1 node + Redis DB test (development_guide.md §6.7)
// Chạy ở process chính của Vitest; process.env gán ở đây được các fork test kế thừa.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { testEnv } from './test-env';

const DEFAULT_REDIS_URL_TEST = 'redis://127.0.0.1:6379/15';

export default async function globalSetup(): Promise<() => Promise<void>> {
  const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const mongoUri = replSet.getUri('hustalo-test');
  const redisUrl = process.env.REDIS_URL_TEST ?? DEFAULT_REDIS_URL_TEST;
  Object.assign(process.env, testEnv, {
    MONGODB_URI: mongoUri,
    REDIS_URL: redisUrl,
    REDIS_URL_TEST: redisUrl,
  });

  // Import động sau khi gán env: env.ts validate process.env lúc import.
  const mongoose = (await import('mongoose')).default;
  const { ensureIndexes } = await import('../infra/db/indexes');
  await mongoose.connect(mongoUri);
  await ensureIndexes();
  await mongoose.disconnect();

  return async () => {
    await replSet.stop();
  };
}
