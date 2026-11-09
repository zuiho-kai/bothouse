#!/usr/bin/env node
/**
 * 用本地 tsc 生成 lib/types 下的类型声明，发布链的 prepack 门禁需要它。
 *
 * tsdown 的 dts 管线与双入口（host/client）不兼容，开启即构建失败，所以声明单独产出。
 * 目录布局必须与 package.json exports 的 types 路径一致：宿主半侧落在 lib/types/index.d.ts，
 * 浏览器半侧落在 lib/types/client/index.d.ts。
 * 只生成声明，不构建 JS、不做类型检查（typecheck 是另一条链）。
 * @module dsh-pet/scripts/gen-types
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = join(ROOT, 'lib', 'types');
const HOST_OUT = join(TYPES, 'host');

rmSync(TYPES, { recursive: true, force: true });
mkdirSync(TYPES, { recursive: true });

// 直接调用本仓库的 tsc，不经 npm/npx：只有 pnpm 或纯 node 的环境里没有 npx，
// 也就不必为 Windows 额外保留 cmd /c 分支。
// 解析走 createRequire：pnpm 的隔离布局下 typescript 在 node_modules 里只链一次，
// require.resolve 比手拼路径可靠。
const require = createRequire(import.meta.url);
const tscEntry = require.resolve('typescript/lib/tsc.js');
const tsc = spawnSync(process.execPath, [tscEntry, '-p', 'tsconfig.types.json'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (tsc.status !== 0) {
  console.error(`[gen-types] 类型声明生成失败 (exit ${tsc.status})`);
  process.exit(tsc.status ?? 1);
}

// 宿主半侧声明上移到 lib/types/ 根（lib/types/index.d.ts），client 子树保持不变。
if (existsSync(HOST_OUT)) {
  for (const name of readdirSync(HOST_OUT)) {
    renameSync(join(HOST_OUT, name), join(TYPES, name));
  }
  rmSync(HOST_OUT, { recursive: true, force: true });
}

console.log('[gen-types] ✓ lib/types 声明生成完成');
