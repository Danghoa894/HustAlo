#!/usr/bin/env node
// scripts/check-traceability.mjs — đối chiếu Test ID trong spec với tên test (development_guide.md §8.8)
//   node scripts/check-traceability.mjs                       → ID của Traceability Matrix
//   node scripts/check-traceability.mjs --milestone M3        → ID trong mục "### M3" của lộ trình
//   --strict                                                  → exit 1 nếu còn ID thiếu test
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ID_RE = /TC-(?:AC|ARCH|DB|AUTH|NET|MSG|GROUP|PRES|CALL-SIG|CALL-MEDIA|CALL-NET|INFRA|SEC|E2EE)-\d{3}/g;
const SCAN_DIRS = ['packages/shared/src', 'server/src', 'client/src', 'client/e2e'];

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const msIndex = args.indexOf('--milestone');
const milestone = msIndex >= 0 ? args[msIndex + 1] : undefined;
if (msIndex >= 0 && !/^M\d$/.test(milestone ?? '')) {
  console.error('[trace] --milestone cần giá trị dạng M0..M7');
  process.exit(2);
}

const guide = readFileSync(join(root, '.spec', 'development_guide.md'), 'utf8');

function sectionIds() {
  if (milestone) {
    const start = guide.search(new RegExp(`^### ${milestone}\\b`, 'm'));
    if (start < 0) throw new Error(`Không tìm thấy mục "### ${milestone}"`);
    const rest = guide.slice(start + 4);
    const next = rest.search(/^#{2,3} /m);
    return guide.slice(start, next < 0 ? undefined : start + 4 + next);
  }
  const start = guide.search(/^## Traceability Matrix/m);
  if (start < 0) throw new Error('Không tìm thấy "## Traceability Matrix"');
  return guide.slice(start);
}

const required = [...new Set(sectionIds().match(ID_RE) ?? [])].sort();

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : walk(full);
    return /\.(test|spec|int\.test)\.[cm]?[jt]sx?$/.test(name) ? [full] : [];
  });
}

// Test ID phải đứng ở ĐẦU tên it(/test(/describe( (có thể nhiều ID liền nhau), chuỗi '…', "…" hoặc `…`.
const TITLE_RE =
  /\b(?:it|test|describe)(?:\.(?:each\([^)]*\)|only|skip|todo|concurrent))*\(\s*(['"`])((?:TC-[A-Z-]+-\d{3}\s*)+)/g;
const covered = new Map();
for (const file of SCAN_DIRS.flatMap((d) => walk(join(root, d)))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(TITLE_RE)) {
    for (const id of m[2].match(ID_RE) ?? []) {
      if (!covered.has(id)) covered.set(id, relative(root, file).replaceAll('\\', '/'));
    }
  }
}

const missing = required.filter((id) => !covered.has(id));
const scope = milestone ? `milestone ${milestone}` : 'Traceability Matrix';
console.log(`[trace] ${scope}: ${required.length - missing.length}/${required.length} Test ID có test`);
for (const id of missing) console.log(`  thiếu: ${id}`);
if (strict && missing.length > 0) process.exit(1);
