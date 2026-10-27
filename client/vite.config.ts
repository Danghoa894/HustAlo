// client/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const certFile = fileURLToPath(new URL('../infra/certs/localhost+lan.pem', import.meta.url));
const keyFile = fileURLToPath(new URL('../infra/certs/localhost+lan-key.pem', import.meta.url));

const API_TARGET = 'http://localhost:4000';

export default defineConfig(({ command }) => {
  // Chỉ dev server cần HTTPS (development_guide.md §1.2); `vite build` không phụ thuộc chứng chỉ.
  const serving = command === 'serve';
  if (serving && (!existsSync(certFile) || !existsSync(keyFile))) {
    throw new Error('Thiếu chứng chỉ HTTPS trong infra/certs. Chạy: mkcert -install && npm run certs');
  }

  return {
    plugins: [react()],
    server: {
      host: true, // lắng nghe 0.0.0.0 để điện thoại trong LAN truy cập được
      port: 5173,
      strictPort: true,
      ...(serving ? { https: { cert: readFileSync(certFile), key: readFileSync(keyFile) } } : {}),
      proxy: {
        '/api': { target: API_TARGET, changeOrigin: false, xfwd: true },
        '/socket.io': { target: API_TARGET, ws: true, changeOrigin: false, xfwd: true },
      },
    },
    preview: { port: 4173, strictPort: true },
    build: { sourcemap: true, target: 'es2022' },
  };
});
