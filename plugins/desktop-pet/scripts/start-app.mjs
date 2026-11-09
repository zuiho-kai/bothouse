#!/usr/bin/env node
/**
 * 开发期直接拉起「单进程桌宠应用」，不打包。
 *
 * 与打包产物的差别只有 Electron 从哪来：这里用本机已解压的 Electron 跑 lib/app.js，
 * 打包产物则把同一批文件塞进自己的 exe；环境变量与打包版一致，方便对照排查。
 * 不下载 Electron、不构建：解压目录与 lib/app.js 都要事先备好，缺 Electron 时这里直接报错退出。
 * 必须始终：清掉 ELECTRON_RUN_AS_NODE，否则 Electron 会以纯 Node 模式启动。
 * @module dsh-pet/scripts/start-app
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

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const electron = [process.env.DSH_PET_ELECTRON_PATH, join(dshHome, 'electron', ELECTRON_REL)].find(
  (value) => value && existsSync(value),
);
if (!electron) {
  console.error('[start-app] 找不到 Electron：先跑 `npm run ensure:electron` 或设置 DSH_PET_ELECTRON_PATH。');
  process.exit(1);
}

const env = { ...process.env };
// 宿主里可能带着它：会让 Electron 以纯 Node 模式启动，应用入口 require('electron') 直接失败
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [join(root, 'lib', 'app.js')], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
