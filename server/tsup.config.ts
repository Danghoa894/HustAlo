import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/infra/db/indexes.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Shared là TS source (exports trỏ tới src/index.ts) → phải bundle vào (kiến trúc §4.3).
  noExternal: ['@hustalo/shared'],
});
