import { defineConfig } from 'vitest/config';
import { testEnv } from './src/test/test-env';

// MONGODB_URI / REDIS_URL do global-setup gán (replica set bộ nhớ, Redis DB test) → không ghi đè ở đây.
const { MONGODB_URI: _mongo, REDIS_URL: _redis, ...integrationEnv } = testEnv;

// Integration: src/**/*.int.test.ts, một MongoMemoryReplSet chung (development_guide.md §6.7)
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: './src/test/global-setup.ts',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    environment: 'node',
    env: integrationEnv,
  },
});
