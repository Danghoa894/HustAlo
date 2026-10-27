#!/usr/bin/env node
// scripts/gen-secrets.mjs
// In ra stdout giá trị bí mật cho môi trường DEV. Không ghi file, không gửi đi đâu, không commit output.
//   node scripts/gen-secrets.mjs             → in toàn bộ khối biến
//   node scripts/gen-secrets.mjs --data-key  → in một cặp "keyId":"base64" để xoay khóa (kiến trúc §9.2.4)
// generateSecrets() được scripts/ci-env.mjs dùng lại (development_guide.md §8.7).
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const b64url = (n) => randomBytes(n).toString('base64url');
const hex = (n) => randomBytes(n).toString('hex');
export const newKeyId = () => {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `k${ym}${hex(2)}`; // ví dụ k2026103fa9 — khớp ^[A-Za-z0-9_-]{1,32}$
};

/** Giá trị bí mật cho infra/.env và server/.env. */
export function generateSecrets() {
  const keyId = newKeyId();
  const redisPassword = hex(24);
  const turnPassword = hex(18);
  return {
    infra: {
      REDIS_PASSWORD: redisPassword,
      TURN_PASSWORD: turnPassword,
      ME_PASSWORD: hex(12),
    },
    server: {
      REDIS_URL: `redis://:${redisPassword}@localhost:6379/0`,
      REDIS_URL_TEST: `redis://:${redisPassword}@localhost:6379/15`,
      JWT_ACCESS_SECRET: b64url(48),
      REFRESH_TOKEN_PEPPER: b64url(32),
      DATA_ENCRYPTION_KEYS: `{"${keyId}":"${randomBytes(32).toString('base64')}"}`,
      DATA_ENCRYPTION_ACTIVE_KEY_ID: keyId,
      TURN_FALLBACK_CREDENTIAL: turnPassword,
    },
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  if (process.argv.includes('--data-key')) {
    console.log(`"${newKeyId()}":"${randomBytes(32).toString('base64')}"`);
    process.exit(0);
  }
  const s = generateSecrets();
  console.log(
    [
      '# ===== infra/.env =====',
      ...Object.entries(s.infra).map(([k, v]) => `${k}=${v}`),
      '',
      '# ===== server/.env =====',
      ...Object.entries(s.server).map(([k, v]) => `${k}=${v}`),
    ].join('\n'),
  );
}
