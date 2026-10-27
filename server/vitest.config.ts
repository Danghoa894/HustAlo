import { defineConfig } from 'vitest/config';
import { testEnv } from './src/test/test-env';

// Unit: src/**/*.test.ts trừ *.int.test.ts
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts', 'node_modules/**'],
    environment: 'node',
    env: testEnv,
  },
});
