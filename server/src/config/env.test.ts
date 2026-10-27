import { describe, expect, it } from 'vitest';
import { testEnv } from '../test/test-env';
import { EnvSchema } from './env';

const parse = (overrides: Record<string, string | undefined>) => {
  const src: Record<string, string | undefined> = { ...testEnv, ...overrides };
  return EnvSchema.safeParse(src);
};

const issuePaths = (r: ReturnType<typeof parse>) => (r.success ? [] : r.error.issues.map((i) => i.path.join('.')));

describe('config/env (fail-fast)', () => {
  it('env mẫu hợp lệ', () => {
    expect(parse({}).success).toBe(true);
  });

  it('TC-ARCH-004 DATA_ENCRYPTION_KEYS không phải JSON object → lỗi, thông điệp không chứa giá trị', () => {
    const secret = 'gia-tri-bi-mat-khong-duoc-in';
    const r = parse({ DATA_ENCRYPTION_KEYS: secret });
    expect(issuePaths(r)).toContain('DATA_ENCRYPTION_KEYS');
    expect(JSON.stringify(r.error?.issues)).not.toContain(secret);
  });

  it('TC-ARCH-004 DATA_ENCRYPTION_ACTIVE_KEY_ID sai định dạng → lỗi', () => {
    expect(issuePaths(parse({ DATA_ENCRYPTION_ACTIVE_KEY_ID: 'có dấu cách' }))).toContain(
      'DATA_ENCRYPTION_ACTIVE_KEY_ID',
    );
  });

  it('MONGODB_URI thiếu replicaSet= → lỗi (AC-ARCH-003)', () => {
    expect(issuePaths(parse({ MONGODB_URI: 'mongodb://localhost:27017/hustalo' }))).toContain('MONGODB_URI');
  });

  it('JWT_ACCESS_SECRET < 32 byte → lỗi', () => {
    expect(issuePaths(parse({ JWT_ACCESS_SECRET: 'ngan' }))).toContain('JWT_ACCESS_SECRET');
  });

  it('COOKIE_SECURE=false chỉ hợp lệ ở development', () => {
    expect(issuePaths(parse({ COOKIE_SECURE: 'false', NODE_ENV: 'test' }))).toContain('COOKIE_SECURE');
    expect(parse({ COOKIE_SECURE: 'false', NODE_ENV: 'development' }).success).toBe(true);
  });

  it('production cấm SEED_PASSWORD và cần ít nhất một nguồn TURN', () => {
    const paths = issuePaths(parse({ NODE_ENV: 'production', SEED_PASSWORD: 'hustalo-dev-2026' }));
    expect(paths).toContain('SEED_PASSWORD');
    expect(paths).toContain('XIRSYS_IDENT');
  });

  it('DEV_CALL_RING_TIMEOUT_MS tùy chọn, ngoài khoảng 5000..120000 → lỗi (DG-08)', () => {
    expect(parse({ DEV_CALL_RING_TIMEOUT_MS: '10000' }).success).toBe(true);
    expect(issuePaths(parse({ DEV_CALL_RING_TIMEOUT_MS: '100' }))).toContain('DEV_CALL_RING_TIMEOUT_MS');
  });
});
