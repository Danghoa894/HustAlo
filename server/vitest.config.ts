import { defineConfig } from 'vitest/config';
import { testEnv } from './src/test/test-env';

const STATE_MACHINE = 'src/modules/calls/call.state-machine.ts';

// Unit: src/**/*.test.ts trừ *.int.test.ts
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts', 'node_modules/**'],
    environment: 'node',
    env: testEnv,
    // Chỉ chạy khi có --coverage. NFR-14: call.state-machine.ts 100% nhánh (ngưỡng theo file, chỉ unit). Ngưỡng 80% dòng
    // cho modules/** tính trên unit + integration gộp: scripts/coverage-merge.mjs (npm run test:coverage ở gốc).
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.int.test.ts'],
      reporter: ['text-summary', 'json'],
      reportsDirectory: 'coverage/unit',
      thresholds: { [STATE_MACHINE]: { branches: 100, statements: 100, functions: 100, lines: 100 } },
    },
  },
});
