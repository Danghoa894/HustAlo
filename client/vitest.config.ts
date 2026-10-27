import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tách khỏi vite.config.ts để test không cần chứng chỉ HTTPS.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
