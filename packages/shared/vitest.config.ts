import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // NFR-14: ≥ 80% dòng cho packages/shared/src/** (chỉ khi có --coverage).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'json'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 80 },
    },
  },
});
