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
    // Chỉ chạy khi có --coverage. NFR-14: call.state-machine.ts 100% nhánh — ngưỡng theo file, không áp toàn repo
    // (mục tiêu 80% cho modules/** và shared là việc của M6).
    coverage: {
      provider: 'v8',
      include: [STATE_MACHINE],
      reporter: ['text', 'json-summary'],
      thresholds: { [STATE_MACHINE]: { branches: 100, statements: 100, functions: 100, lines: 100 } },
    },
  },
});
