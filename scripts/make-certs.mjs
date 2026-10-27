#!/usr/bin/env node
// scripts/make-certs.mjs — sinh chứng chỉ HTTPS dev bằng mkcert cho localhost + LAN-IP (development_guide.md §1.2, §5.1)
// Output: infra/certs/localhost+lan.pem, infra/certs/localhost+lan-key.pem (gitignored). Cần chạy `mkcert -install` trước.
//   node scripts/make-certs.mjs                  → localhost, 127.0.0.1, ::1 + mọi IPv4 LAN của máy
//   node scripts/make-certs.mjs 192.168.1.23     → thêm host/IP chỉ định
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const certDir = join(root, 'infra', 'certs');

const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);
const hosts = [...new Set(['localhost', '127.0.0.1', '::1', ...lanIps, ...process.argv.slice(2)])];

const probe = spawnSync('mkcert', ['-version'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (probe.status !== 0) {
  console.error('[certs] Không tìm thấy mkcert. Cài đặt (development_guide.md §1.1) rồi chạy: mkcert -install');
  process.exit(1);
}

mkdirSync(certDir, { recursive: true });
const result = spawnSync(
  'mkcert',
  ['-cert-file', join(certDir, 'localhost+lan.pem'), '-key-file', join(certDir, 'localhost+lan-key.pem'), ...hosts],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[certs] Đã tạo chứng chỉ cho: ${hosts.join(', ')}`);
