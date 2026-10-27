// scripts/check-bundle-secrets.mjs (AC-ARCH-011, AC-105, EC-SEC-006): chạy bản sao script trên repo giả trong thư mục tạm.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../../scripts/check-bundle-secrets.mjs', import.meta.url));

// Giá trị giả, chỉ dùng trong test.
const FAKE = {
  JWT_ACCESS_SECRET: 'fake-jwt-secret-value-0123456789abcdef',
  REFRESH_TOKEN_PEPPER: 'fake-pepper-value-0123456789abcdef',
  XIRSYS_SECRET: 'fake-xirsys-secret-0123456789',
  DATA_KEY: Buffer.alloc(32, 5).toString('base64'),
};

const dirs: string[] = [];

function makeRepo(opts: { dist?: Record<string, string>; clientEnv?: string }) {
  const root = mkdtempSync(join(tmpdir(), 'hustalo-bundle-'));
  dirs.push(root);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(script, join(root, 'scripts', 'check-bundle-secrets.mjs'));
  mkdirSync(join(root, 'server'));
  writeFileSync(
    join(root, 'server', '.env'),
    [
      `JWT_ACCESS_SECRET=${FAKE.JWT_ACCESS_SECRET}`,
      `REFRESH_TOKEN_PEPPER=${FAKE.REFRESH_TOKEN_PEPPER}`,
      'XIRSYS_IDENT=fake-ident-0123',
      `XIRSYS_SECRET=${FAKE.XIRSYS_SECRET}`,
      `DATA_ENCRYPTION_KEYS={"k1":"${FAKE.DATA_KEY}"}`,
    ].join('\n'),
  );
  mkdirSync(join(root, 'client'));
  if (opts.clientEnv !== undefined) writeFileSync(join(root, 'client', '.env'), opts.clientEnv);
  if (opts.dist) {
    mkdirSync(join(root, 'client', 'dist', 'assets'), { recursive: true });
    for (const [name, content] of Object.entries(opts.dist)) writeFileSync(join(root, 'client', 'dist', name), content);
  }
  return root;
}

function run(root: string) {
  // env tối thiểu: không để biến môi trường của tiến trình test lọt vào script.
  const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'check-bundle-secrets.mjs')], { env, encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('check-bundle-secrets', () => {
  it('TC-ARCH-011 TC-SEC-006 dist sạch → exit 0', () => {
    const root = makeRepo({ dist: { 'index.html': '<html></html>', 'assets/app.js': 'console.log(1)' } });
    expect(run(root).status).toBe(0);
  });

  it.each([
    ['JWT_ACCESS_SECRET', FAKE.JWT_ACCESS_SECRET],
    ['REFRESH_TOKEN_PEPPER', FAKE.REFRESH_TOKEN_PEPPER],
    ['XIRSYS_SECRET', FAKE.XIRSYS_SECRET],
    ['DATA_ENCRYPTION_KEYS.k1', FAKE.DATA_KEY],
  ])('TC-ARCH-011 TC-SEC-006 dist chứa giá trị %s → exit 1, chỉ in tên biến', (name, value) => {
    const root = makeRepo({ dist: { 'assets/app.js': `const x = "${value}";` } });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain(name);
    expect(r.output).not.toContain(value);
  });

  it('TC-SEC-006 biến VITE_* mang tên nhạy cảm trong client/.env → exit 1', () => {
    const root = makeRepo({ dist: { 'index.html': '' }, clientEnv: 'VITE_API_URL=/api/v1\nVITE_XIRSYS_SECRET=abc\n' });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain('VITE_XIRSYS_SECRET');
  });

  it('chưa build client → exit 1', () => {
    const r = run(makeRepo({}));
    expect(r.status).toBe(1);
    expect(r.output).toContain('Chưa build client');
  });
});
