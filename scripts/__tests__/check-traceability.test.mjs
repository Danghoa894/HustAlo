// scripts/__tests__/check-traceability.test.mjs — tham số --milestone của check-traceability.mjs (development_guide.md §8.8).
// Chạy bằng node:test (npm run test:scripts), đọc spec thật trong .spec/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../check-traceability.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('chấp nhận M0..M7', () => {
  for (const m of ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']) {
    const r = run('--milestone', m);
    assert.equal(r.status, 0, `${m}: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`milestone ${m}: \\d+/\\d+`));
  }
});

test('chấp nhận M6.5 và chỉ lấy ID trong mục "### M6.5"', () => {
  const r = run('--milestone', 'M6.5');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /milestone M6\.5: \d+\/2 /);
});

test('M6 không lấy nhầm ID của M6.5', () => {
  const r = run('--milestone', 'M6');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /TC-ARCH-01[67]/);
});

test('từ chối giá trị sai dạng với exit 2', () => {
  for (const m of ['M8x', 'M6.4', 'M65', 'm1', 'M6.', '6.5']) {
    const r = run('--milestone', m);
    assert.equal(r.status, 2, m);
    assert.match(r.stderr, /M0\.\.M7 hoặc M6\.5/);
  }
  assert.equal(run('--milestone').status, 2);
});

test('--strict exit 1 khi còn ID thiếu test', () => {
  const r = run('--milestone', 'M6.5', '--strict');
  const missing = /thiếu: /.test(r.stdout);
  assert.equal(r.status, missing ? 1 : 0);
});
