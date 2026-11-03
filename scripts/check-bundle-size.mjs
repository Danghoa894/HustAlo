#!/usr/bin/env node
// scripts/check-bundle-size.mjs — NFR-05: bundle JS khởi tạo ≤ 300 KB gzip. "Khởi tạo" = mọi <script src> và
// <link rel="modulepreload"> trong client/dist/index.html (chunk tải lười như thư viện Signal ở M7 không tính).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const LIMIT = 300 * 1024;
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'client', 'dist');
const indexFile = join(dist, 'index.html');
if (!existsSync(indexFile)) {
  console.error('[bundle-size] Chưa build client (client/dist/index.html không tồn tại)');
  process.exit(1);
}
const html = readFileSync(indexFile, 'utf8');
const refs = [
  ...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g),
].map((m) => m[1]);

let total = 0;
for (const ref of new Set(refs)) {
  const file = join(dist, ref.replace(/^\//, ''));
  if (!existsSync(file)) continue;
  const size = gzipSync(readFileSync(file), { level: 9 }).length;
  total += size;
  console.log(`[bundle-size] ${ref}: ${(size / 1024).toFixed(1)} KB gzip`);
}
console.log(`[bundle-size] tổng JS khởi tạo: ${(total / 1024).toFixed(1)} KB gzip (giới hạn ${LIMIT / 1024} KB)`);
if (total > LIMIT) {
  console.error('[bundle-size] vượt NFR-05');
  process.exit(1);
}
