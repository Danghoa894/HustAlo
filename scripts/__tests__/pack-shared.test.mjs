// scripts/__tests__/pack-shared.test.mjs — kiểm tra phần thuần của pack-shared.mjs (development_guide.md §2.7).
// Chạy bằng node:test (npm run test:scripts). Không build/pack thật (chậm, cần tsup) — xem PR mô tả cách thử tay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UsageError, assertTagMatches, assertVersion, releaseManifest } from '../pack-shared.mjs';

const script = fileURLToPath(new URL('../pack-shared.mjs', import.meta.url));
const workspacePkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../packages/shared/package.json', import.meta.url)), 'utf8'),
);

test('version workspace là semver X.Y.Z', () => {
  assert.doesNotThrow(() => assertVersion(workspacePkg.version));
});

test('assertVersion từ chối pre-release, thiếu phần, số 0 đứng đầu', () => {
  for (const v of ['1.0', '1.0.0-beta.1', '01.0.0', 'v1.0.0', '', undefined]) {
    assert.throws(() => assertVersion(v), UsageError, String(v));
  }
});

test('tag phải đúng shared-v<version>', () => {
  assert.doesNotThrow(() => assertTagMatches('shared-v1.2.3', '1.2.3'));
  for (const tag of ['shared-v1.2.4', 'v1.2.3', 'shared-1.2.3', 'shared-v1.2.3 ']) {
    assert.throws(() => assertTagMatches(tag, '1.2.3'), UsageError, tag);
  }
});

test('manifest phát hành: exports trỏ dist/, không private, zod đúng phiên bản workspace', () => {
  const m = releaseManifest(workspacePkg);
  assert.equal(m.name, '@hustalo/shared');
  assert.equal(m.version, workspacePkg.version);
  assert.equal(m.license, workspacePkg.license);
  assert.equal(m.type, 'module');
  assert.deepEqual(m.exports, { '.': { types: './dist/index.d.ts', default: './dist/index.js' } });
  assert.deepEqual(m.files, ['dist']);
  assert.equal('private' in m, false);
  assert.equal('devDependencies' in m, false);
  assert.deepEqual(m.dependencies, { zod: workspacePkg.dependencies.zod });
});

test('manifest từ chối zod không khóa phiên bản chính xác', () => {
  assert.throws(() => releaseManifest({ ...workspacePkg, dependencies: { zod: '^4.0.0' } }), UsageError);
  assert.throws(() => releaseManifest({ ...workspacePkg, dependencies: {} }), UsageError);
});

test('CLI: tag sai → exit 2 trước khi build, không in file=', () => {
  const r = spawnSync(process.execPath, [script, '--tag', 'shared-v0.0.0-sai', '--skip-checks'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /không khớp version/);
  assert.doesNotMatch(r.stdout, /file=/);
});

test('CLI: tham số lạ → exit 2', () => {
  const r = spawnSync(process.execPath, [script, '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /tham số lạ/);
});
