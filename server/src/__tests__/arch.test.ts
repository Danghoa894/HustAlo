// Kiểm tra kiến trúc tĩnh: hợp đồng chỉ định nghĩa ở @hustalo/shared (AC-ARCH-002).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCode, EVENTS } from '@hustalo/shared';
import * as enums from '@hustalo/shared';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const SCAN_DIRS = ['server/src', 'client/src'];

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const sources = SCAN_DIRS.flatMap((d) => walk(join(repoRoot, d))).map((file) => ({
  file: relative(repoRoot, file).replaceAll('\\', '/'),
  text: readFileSync(file, 'utf8'),
}));

// Tên export của shared là enum/hằng dạng object (PascalCase) hoặc UPPER_SNAKE.
const sharedNames = Object.keys(enums).filter((n) => /^[A-Z]/.test(n));

describe('AC-ARCH-002 hợp đồng chỉ ở @hustalo/shared', () => {
  it('TC-ARCH-002 server/client không khai báo lại enum, hằng số, ErrorCode hay EVENTS của shared', () => {
    const offenders: string[] = [];
    for (const { file, text } of sources) {
      for (const name of sharedNames) {
        const decl = new RegExp(
          `^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const|let|var|enum|type|interface|class)\\s+${name}\\b`,
          'm',
        );
        if (decl.test(text)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('TC-ARCH-002 không viết chuỗi tên event trực tiếp ngoài event-names.ts', () => {
    const eventNames = Object.values(EVENTS);
    const offenders: string[] = [];
    for (const { file, text } of sources) {
      for (const name of eventNames) {
        if (text.includes(`'${name}'`) || text.includes(`"${name}"`) || text.includes(`\`${name}\``)) {
          offenders.push(`${file}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('TC-ARCH-002 không gõ lại danh sách ErrorCode dạng object literal', () => {
    const codes = Object.values(ErrorCode);
    const offenders = sources
      .filter(({ text }) => codes.filter((c) => new RegExp(`\\b${c}\\s*:\\s*['"]${c}['"]`).test(text)).length >= 3)
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('quét thấy mã nguồn server (tự kiểm tra test)', () => {
    expect(sources.some((s) => s.file.startsWith('server/src/'))).toBe(true);
  });
});
