#!/usr/bin/env node
// scripts/check-bundle-secrets.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath: đúng cả với đường dẫn Windows có dấu cách/ký tự bị mã hóa trong URL.
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'client', 'dist');
const parseEnvFile = (p) =>
  existsSync(p)
    ? Object.fromEntries(
        readFileSync(p, 'utf8')
          .split(/\r?\n/)
          .filter((l) => /^[A-Z0-9_]+=/.test(l))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      )
    : {};

const serverEnv = { ...parseEnvFile(join(root, 'server', '.env')), ...process.env };
const secrets = [];
for (const name of [
  'JWT_ACCESS_SECRET',
  'REFRESH_TOKEN_PEPPER',
  'XIRSYS_IDENT',
  'XIRSYS_SECRET',
  'TURN_FALLBACK_CREDENTIAL',
  'SEED_PASSWORD',
]) {
  if ((serverEnv[name] ?? '').length >= 8) secrets.push([name, serverEnv[name]]);
}
const redisPass = /^redis:\/\/[^:]*:([^@]+)@/.exec(serverEnv.REDIS_URL ?? '')?.[1];
if (redisPass && redisPass.length >= 8) secrets.push(['REDIS_URL(password)', redisPass]);
try {
  for (const [id, key] of Object.entries(JSON.parse(serverEnv.DATA_ENCRYPTION_KEYS ?? '{}'))) {
    secrets.push([`DATA_ENCRYPTION_KEYS.${id}`, String(key)]);
  }
} catch {
  /* env.ts đã chặn JSON sai khi chạy server; ở đây bỏ qua */
}

let failed = false;
const forbiddenName = /SECRET|PEPPER|PASSWORD|CREDENTIAL|PRIVATE|XIRSYS|DATA_ENCRYPTION|JWT/i;
const clientEnvNames = [
  ...['.env', '.env.local', '.env.production', '.env.production.local'].flatMap((f) =>
    Object.keys(parseEnvFile(join(root, 'client', f))),
  ),
  ...Object.keys(process.env),
];
for (const name of new Set(clientEnvNames)) {
  if (name.startsWith('VITE_') && forbiddenName.test(name)) {
    console.error(`[bundle-secrets] Biến client bị cấm: ${name}`);
    failed = true;
  }
}

if (!existsSync(dist)) {
  console.error('[bundle-secrets] Chưa build client (client/dist không tồn tại)');
  process.exit(1);
}
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
for (const file of walk(dist)) {
  const content = readFileSync(file, 'latin1');
  for (const [name, value] of secrets) {
    if (content.includes(value)) {
      console.error(`[bundle-secrets] Giá trị của ${name} xuất hiện trong ${file}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log(`[bundle-secrets] OK — đã quét ${secrets.length} giá trị bí mật`);
