import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/infra/db/indexes.ts', 'src/infra/db/migrate.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Shared là TS source (exports trỏ tới src/index.ts) → phải bundle vào (kiến trúc §4.3).
  noExternal: ['@hustalo/shared'],
  // Lua đọc lúc chạy bằng new URL('./scripts/*.lua', import.meta.url) → cạnh dist/main.js (infra/redis/scripts.ts).
  onSuccess: () => {
    cpSync('src/infra/redis/scripts', 'dist/scripts', { recursive: true });
    return Promise.resolve();
  },
});
