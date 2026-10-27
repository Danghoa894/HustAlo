#!/usr/bin/env node
// scripts/ci-env.mjs — sinh infra/.env, server/.env, client/.env từ các .env.example với secret ngẫu nhiên
// (development_guide.md §8.7). Dùng trong CI và lần đầu ở máy dev. KHÔNG in giá trị ra log.
// File đã tồn tại được giữ nguyên (thêm --force để ghi đè).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSecrets } from './gen-secrets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const force = process.argv.includes('--force');
const secrets = generateSecrets();

/** Thay giá trị các biến có trong `values`; bỏ comment "# KEY=" nếu biến đang bị comment. */
function fill(template, values) {
  return template
    .split(/\r?\n/)
    .map((line) => {
      const m = /^([A-Z0-9_]+)=/.exec(line);
      return m && m[1] in values ? `${m[1]}=${values[m[1]]}` : line;
    })
    .join('\n');
}

const targets = [
  ['infra', secrets.infra],
  ['server', secrets.server],
  ['client', {}],
];

for (const [dir, values] of targets) {
  const example = join(root, dir, '.env.example');
  const target = join(root, dir, '.env');
  if (existsSync(target) && !force) {
    console.log(`[ci-env] giữ nguyên ${dir}/.env (đã tồn tại)`);
    continue;
  }
  writeFileSync(target, fill(readFileSync(example, 'utf8'), values));
  console.log(`[ci-env] đã tạo ${dir}/.env`);
}
