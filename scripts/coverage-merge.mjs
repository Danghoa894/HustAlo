#!/usr/bin/env node
// scripts/coverage-merge.mjs — NFR-14: gộp coverage unit + integration của server (istanbul JSON do @vitest/coverage-v8
// ghi ở server/coverage/{unit,integration}/coverage-final.json), in tóm tắt cho server/src/modules/** và fail nếu
// tỉ lệ dòng < 80%. packages/shared tự áp ngưỡng 80% trong vitest.config.ts của nó.
//   npm run test:coverage   (gốc repo: chạy cả hai lượt rồi gọi script này)
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import libCoverage from 'istanbul-lib-coverage';

const root = fileURLToPath(new URL('..', import.meta.url));
const THRESHOLD = 80;
const inputs = ['unit', 'integration'].map((k) => join(root, 'server', 'coverage', k, 'coverage-final.json'));

const map = libCoverage.createCoverageMap({});
for (const file of inputs) {
  if (!existsSync(file)) {
    console.error(`[coverage] thiếu ${relative(root, file)} — chạy test unit/integration với --coverage trước`);
    process.exit(1);
  }
  map.merge(JSON.parse(readFileSync(file, 'utf8')));
}

const modulesDir = join(root, 'server', 'src', 'modules');
const total = libCoverage.createCoverageSummary();
const rows = [];
for (const file of map.files()) {
  if (!file.startsWith(modulesDir)) continue;
  const s = map.fileCoverageFor(file).toSummary();
  total.merge(s);
  rows.push([relative(root, file).replaceAll('\\', '/'), s.lines.pct]);
}
rows.sort((a, b) => a[1] - b[1]);
for (const [f, pct] of rows.slice(0, 10)) console.log(`  ${String(pct).padStart(6)}%  ${f}`);
const pct = (m) => `${m.pct}% (${m.covered}/${m.total})`;
console.log(
  `[coverage] server/src/modules/** (unit + integration): dòng ${pct(total.lines)}, nhánh ${pct(total.branches)}, hàm ${pct(total.functions)}`,
);
if (total.lines.pct < THRESHOLD) {
  console.error(`[coverage] dòng ${total.lines.pct}% < ${THRESHOLD}% (NFR-14)`);
  process.exit(1);
}
