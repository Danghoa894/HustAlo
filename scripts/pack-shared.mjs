#!/usr/bin/env node
// scripts/pack-shared.mjs — npm run shared:pack (development_guide.md §2.7, D-24).
// Đóng gói @hustalo/shared thành tarball cho repo HustAlo-client:
//   1. typecheck + unit test packages/shared;
//   2. tsup → packages/shared/.pack/dist/index.js (ESM, một file) + index.d.ts;
//   3. ghi package.json phát hành (exports trỏ dist/, dependencies.zod đúng phiên bản workspace, không có private);
//   4. npm pack → packages/shared/hustalo-shared-<version>.tgz.
// Tham số:
//   --tag <tag>     bắt buộc khớp `shared-v<version>` (workflow release-shared.yml truyền GITHUB_REF_NAME)
//   --skip-checks   bỏ bước 1 (chỉ dùng khi vừa chạy typecheck/test ngay trước đó)
// Kết quả cuối in ra stdout: `file=<tên .tgz>` và `integrity=<sha512-…>` (workflow đọc dòng `file=`).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Lỗi do người dùng truyền sai (exit 2), khác lỗi build (exit 1). */
export class UsageError extends Error {}

/** Kiểm tra version semver (không nhận pre-release/build metadata để tag luôn so được bằng chuỗi). */
export function assertVersion(version) {
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new UsageError(`packages/shared/package.json: version "${String(version)}" không phải semver X.Y.Z`);
  }
}

/** Tag Release phải đúng `shared-v<version>` (development_guide.md §2.7). */
export function assertTagMatches(tag, version) {
  const expected = `shared-v${version}`;
  if (tag !== expected) {
    throw new UsageError(`tag "${tag}" không khớp version trong packages/shared/package.json (cần "${expected}")`);
  }
}

/** package.json của bản phát hành, suy ra từ package.json workspace. */
export function releaseManifest(pkg) {
  assertVersion(pkg.version);
  const zod = pkg.dependencies?.zod;
  if (!zod || !/^\d+\.\d+\.\d+$/.test(zod)) {
    throw new UsageError('packages/shared/package.json: dependencies.zod phải là phiên bản chính xác (save-exact)');
  }
  return {
    name: pkg.name,
    version: pkg.version,
    description: 'HUSTALO — hợp đồng dùng chung (enum, hằng số, mã lỗi, Zod schema, event) cho client và server',
    license: pkg.license,
    repository: { type: 'git', url: 'git+https://github.com/Danghoa894/HustAlo.git', directory: 'packages/shared' },
    type: 'module',
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    files: ['dist'],
    sideEffects: false,
    dependencies: { zod },
  };
}

function parseArgs(argv) {
  const opts = { tag: undefined, skipChecks: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--skip-checks') opts.skipChecks = true;
    else if (a === '--tag') {
      opts.tag = argv[i + 1];
      if (!opts.tag) throw new UsageError('--tag cần giá trị, ví dụ --tag shared-v1.0.0');
      i += 1;
    } else throw new UsageError(`tham số lạ: ${a}`);
  }
  return opts;
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Node ≥ 20 trên Windows từ chối spawn .cmd không qua shell (CVE-2024-27980); tham số ở đây không có dữ liệu người dùng.
const npm = (args, cwd) =>
  execFileSync(npmCmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sharedDir = join(root, 'packages', 'shared');
  const packDir = join(sharedDir, '.pack');
  const opts = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(join(sharedDir, 'package.json'), 'utf8'));
  const manifest = releaseManifest(pkg);
  if (opts.tag !== undefined) assertTagMatches(opts.tag, pkg.version);

  if (!opts.skipChecks) {
    process.stderr.write('[shared:pack] typecheck + unit test packages/shared\n');
    npm(['run', 'typecheck', '-w', 'packages/shared'], root);
    npm(['run', 'test:unit', '-w', 'packages/shared'], root);
  }

  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  const { build } = await import('tsup');
  await build({
    entry: { index: join(sharedDir, 'src', 'index.ts') },
    outDir: join(packDir, 'dist'),
    format: ['esm'],
    target: 'es2022',
    platform: 'neutral',
    dts: { compilerOptions: { noEmit: false } },
    tsconfig: join(sharedDir, 'tsconfig.json'),
    external: ['zod'],
    sourcemap: false,
    splitting: false,
    clean: true,
    silent: true,
  });
  for (const f of ['index.js', 'index.d.ts']) {
    if (!existsSync(join(packDir, 'dist', f))) throw new Error(`tsup không tạo dist/${f}`);
  }
  writeFileSync(join(packDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  copyFileSync(join(root, 'LICENSE'), join(packDir, 'LICENSE'));
  writeFileSync(
    join(packDir, 'README.md'),
    `# ${manifest.name} ${manifest.version}\n\n${manifest.description}.\n\n` +
      'Phát hành từ `packages/shared` của https://github.com/Danghoa894/HustAlo (development_guide.md §2.7). ' +
      'Không sửa tay; phiên bản đã phát hành là bất biến.\n',
  );

  const out = JSON.parse(npm(['pack', '--json', '--pack-destination', sharedDir], packDir).toString('utf8'));
  const { filename, integrity } = out[0];
  process.stdout.write(`file=${filename}\nintegrity=${integrity}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`[shared:pack] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(err instanceof UsageError ? 2 : 1);
  });
}
