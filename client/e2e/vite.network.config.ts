// client/e2e/vite.network.config.ts — Vite dev thứ hai cho E2E mạng (call-network.spec.ts, DG §6.6): cổng 5174, proxy
// /api + /socket.io tới server riêng ở cổng 4100 (ICE_TRANSPORT_POLICY=relay; restart được giữa cuộc gọi — AC-092).
// cacheDir riêng để không tranh thư mục pre-bundle với Vite chính (5173).
import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import base from '../vite.config';

export const NETWORK_CLIENT_PORT = 5174;
export const NETWORK_SERVER_PORT = 4100;
const target = `http://localhost:${NETWORK_SERVER_PORT}`;

export default defineConfig((env) =>
  mergeConfig(typeof base === 'function' ? base(env) : (base as UserConfig), {
    cacheDir: 'node_modules/.vite-network',
    server: {
      port: NETWORK_CLIENT_PORT,
      proxy: {
        '/api': { target },
        '/socket.io': { target },
      },
    },
  }),
);
