// AC-ARCH-001: import/no-cycle + ràng buộc import theo thư mục, chạy ESLint thật với `architectureConfigs`
// của eslint.config.js trên fixture tạm (thư mục __arch_fixtures__ bị eslint.config.js bỏ qua khi lint repo).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureRoot = join(repoRoot, '__arch_fixtures__');

// Cấu trúc giả lập đúng đường dẫn thư mục để `files` của từng config khớp (fixture nằm dưới __arch_fixtures__/).
const FIXTURES: Record<string, string> = {
  'packages/shared/src/bad-mongoose.ts': "import mongoose from 'mongoose';\nexport const m = mongoose;\n",
  'packages/shared/src/good.ts': "import { z } from 'zod';\nexport const s = z.string();\n",
  'client/src/bad-node.ts': "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n",
  'client/src/bad-server.ts': "import { x } from '../../server/src/thing';\nexport const y = x;\n",
  'server/src/thing.ts': 'export const x = 1;\n',
  'server/src/bad-react.ts': "import React from 'react';\nexport const r = React;\n",
  'server/src/cycle-a.ts': "import { b } from './cycle-b';\nexport const a = (): number => b() + 1;\n",
  'server/src/cycle-b.ts': "import { a } from './cycle-a';\nexport const b = (): number => a() - 1;\n",
  'server/src/modules/users/user.model.ts': 'export const UserModel = {};\n',
  'server/src/modules/auth/auth.service.ts':
    "import { UserModel } from '../users/user.model';\nexport const s = UserModel;\n",
  'server/src/modules/users/users.service.ts':
    "import { UserModel } from './user.model';\nexport const s = UserModel;\n",
  'server/src/realtime/emitter.ts': 'export const emit = (): void => undefined;\n',
  'server/src/modules/users/users.repository.ts':
    "import { emit } from '../../realtime/emitter';\nexport const r = emit;\n",
  'server/src/modules/users/users.controller.ts': "import { z } from 'zod';\nexport const c = z.object({});\n",
};

let results: Map<string, ESLint.LintResult>;

function messages(relPath: string): { ruleId: string | null; message: string }[] {
  const r = results.get(relPath);
  if (!r) throw new Error(`Không có kết quả lint cho ${relPath}`);
  return r.messages.map((m) => ({ ruleId: m.ruleId, message: m.message }));
}

const ruleIds = (relPath: string) => messages(relPath).map((m) => m.ruleId);

beforeAll(async () => {
  for (const [rel, content] of Object.entries(FIXTURES)) {
    const file = join(fixtureRoot, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const { architectureConfigs } = (await import(pathToFileURL(join(repoRoot, 'eslint.config.js')).href)) as {
    architectureConfigs: Linter.Config[];
  };
  const eslint = new ESLint({
    cwd: fixtureRoot,
    ignore: false,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser, sourceType: 'module' } },
      ...architectureConfigs,
    ],
  });
  const lint = await eslint.lintFiles(Object.keys(FIXTURES).map((rel) => join(fixtureRoot, rel)));
  results = new Map(lint.map((r) => [r.filePath.slice(fixtureRoot.length + 1).replaceAll('\\', '/'), r]));
}, 60_000);

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('AC-ARCH-001 kiến trúc import (eslint.config.js)', () => {
  it('TC-ARCH-001 import vòng → import/no-cycle', () => {
    expect(ruleIds('server/src/cycle-a.ts')).toContain('import/no-cycle');
    expect(ruleIds('server/src/cycle-b.ts')).toContain('import/no-cycle');
  });

  it('TC-ARCH-001 packages/shared không import mongoose (I/O)', () => {
    expect(ruleIds('packages/shared/src/bad-mongoose.ts')).toContain('no-restricted-imports');
    expect(ruleIds('packages/shared/src/good.ts')).toEqual([]);
  });

  it('TC-ARCH-001 client/src không import node:* hay server/**', () => {
    expect(ruleIds('client/src/bad-node.ts')).toContain('no-restricted-imports');
    expect(ruleIds('client/src/bad-server.ts')).toContain('no-restricted-imports');
  });

  it('TC-ARCH-001 server không import react', () => {
    expect(ruleIds('server/src/bad-react.ts')).toContain('no-restricted-imports');
  });

  it('TC-ARCH-001 module không import model/repository của module khác; cùng module thì được', () => {
    expect(ruleIds('server/src/modules/auth/auth.service.ts')).toContain('no-restricted-imports');
    expect(ruleIds('server/src/modules/users/users.service.ts')).toEqual([]);
  });

  it('TC-ARCH-001 repository không import realtime/**', () => {
    expect(ruleIds('server/src/modules/users/users.repository.ts')).toContain('no-restricted-imports');
  });

  it('TC-ARCH-001 controller không khai báo z.* (hợp đồng ở @hustalo/shared)', () => {
    expect(ruleIds('server/src/modules/users/users.controller.ts')).toContain('no-restricted-syntax');
  });
});
