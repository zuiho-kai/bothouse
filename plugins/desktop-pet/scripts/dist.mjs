#!/usr/bin/env node
/**
 * 打包双击可运行的桌宠应用，是 electron-builder 的薄封装，产物只有「解包目录」一种形态。
 * 只出解包目录：portable 是 NSIS 自解压壳，每次启动都要把整个应用目录解压到 %TEMP%，对 Electron 体量得不偿失；
 * nsis 安装包对自用与绿色分发没有增量价值，故不提供。
 * 不下载 Electron：默认只认本机已解压目录，找不到就明确失败，避免本地开发被静默拉走一百多兆；
 * 只有设了 DSH_PET_ALLOW_ELECTRON_DOWNLOAD=1 才交回 electron-builder 自行下载（CI 用）。
 * 打包二进制统一走 npmmirror 镜像，因为本机 github.com 不通。
 * @module dsh-pet/scripts/dist
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** Electron 可执行文件相对解压目录的路径（按平台）。 */
const ELECTRON_REL =
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron';

/**
 * 解析本机 Electron 解压目录，一个字节都不下载。
 *
 * 候选依次是 DSH_PET_ELECTRON_DIST、DSH_PET_ELECTRON_PATH 所在目录、$DSH_HOME/electron；
 * 本机都没有时：开了允许下载就返回 undefined（不传 electronDist），否则直接退出进程。
 *
 * @returns 解压目录，或 undefined（交给 electron-builder 下载）。
 */
function resolveElectronDist() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const candidates = [
    process.env.DSH_PET_ELECTRON_DIST,
    process.env.DSH_PET_ELECTRON_PATH ? dirname(process.env.DSH_PET_ELECTRON_PATH) : undefined,
    join(dshHome, 'electron'),
  ].filter((value) => Boolean(value));
  for (const dir of candidates) {
    if (existsSync(join(dir, ELECTRON_REL))) return dir;
  }
  if (process.env.DSH_PET_ALLOW_ELECTRON_DOWNLOAD === '1') {
    console.warn('[dist] 本机没有 Electron 解压目录，交给 electron-builder 下载（CI 模式）。');
    return undefined;
  }
  console.error(
    '[dist] 找不到本机 Electron 解压目录。先跑 `npm run ensure:electron`，' +
      '或设置 DSH_PET_ELECTRON_DIST 指向解压目录。',
  );
  process.exit(1);
}

const target = process.argv[2] ?? 'dir';
if (target !== 'dir') {
  console.error(`[dist] 未知目标：${target}（只出解包目录，直接运行 node scripts/dist.mjs）`);
  process.exit(2);
}

const electronDist = resolveElectronDist();
/** mirror 默认 npmmirror：本机 github.com 不通；CI 上可用环境变量覆盖成官方源 */
const env = {
  ...process.env,
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  // 不自动发现代码签名身份：本机没有证书，跳过签名探测，免得打包末尾才失败
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
};
// 有本地解压目录时才禁止 Electron 下载；CI 的回退路径反过来必须允许下载
if (electronDist) {
  env.DSH_PET_ELECTRON_DIST = electronDist;
  env.ELECTRON_SKIP_BINARY_DOWNLOAD = '1';
} else {
  delete env.DSH_PET_ELECTRON_DIST;
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
}

console.log(`[dist] electron dist: ${electronDist ?? '(无 → 由 electron-builder 下载)'}`);
console.log(`[dist] target:        win:${target}`);
// 直接调用 electron-builder 的 CLI 文件而不经 `pnpm exec`：安装路径可能含单引号，
// 走 shell 传参会被切碎；node 直接 spawn 没有这层转义问题。
const cli = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const args = [cli, '--win', target];
if (electronDist) args.push(`--config.electronDist=${electronDist}`);
const child = spawn(process.execPath, args, {
  cwd: root,
  env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
