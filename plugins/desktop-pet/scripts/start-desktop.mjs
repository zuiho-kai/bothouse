#!/usr/bin/env node
/**
 * 本地开发或手动启动桌面 Helper，不经宿主拉起。
 *
 * 参数是一个成品配置地址，缺省指向本机 3080 端口的 /dsh-pet-7340/config；
 * 其余端点由渲染端从 configUrl 推导，本脚本只负责透传。
 * 不下载 Electron：找不到可执行文件即提示先跑 npm run ensure:electron。
 * 环境变量与宿主拉起时一致：配置地址、缩放倍数、Electron 路径。
 * 必须始终：删掉 ELECTRON_RUN_AS_NODE，并带上 DSH_PET_HOST_PID，让 Helper 在本进程退出后自行收尾。
 * @module dsh-pet/scripts/start-desktop
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const helperMain = resolve(here, '..', 'runtime', 'electron-helper', 'main.js');
const defaultConfigUrl =
  process.env.DSH_PET_CONFIG_URL || process.argv[2] || 'http://127.0.0.1:3080/dsh-pet-7340/config';

// Electron 可执行文件相对解压目录的路径（按平台）。
const PLAT = process.platform;
const electronRel =
  PLAT === 'win32'
    ? 'electron.exe'
    : PLAT === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron';

// 解析 Electron 可执行文件；不自动下载，缺了就提示先跑 ensure:electron。
const candidates = [
  process.env.DSH_PET_ELECTRON_PATH,
  process.env.ELECTRON_PATH,
  join(
    process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh'),
    'electron',
    electronRel,
  ),
];
const electron = candidates.find((value) => value && existsSync(value));
if (!electron) {
  console.error(
    '[start-desktop] Electron not found. Run `npm run ensure:electron` first or set DSH_PET_ELECTRON_PATH.',
  );
  process.exit(1);
}

const env = {
  ...process.env,
  DSH_PET_CONFIG_URL: defaultConfigUrl,
  DSH_PET_SCALE: process.env.DSH_PET_SCALE || '1',
  // 开发流也要跟随：本脚本退出（含被强杀）后 Helper 必须自己收尾，不留一个没人管的后台窗口。
  // Helper 侧 host-liveness.js 每 2s 探测一次本进程 pid，ESRCH 即自行退出。
  DSH_PET_HOST_PID: String(process.pid),
};
// 删掉会劫持 Electron 启动模式的变量：终端/宿主里若带着 ELECTRON_RUN_AS_NODE，
// Electron 会以纯 Node 模式启动，main.js 顶部 require('electron') 直接 MODULE_NOT_FOUND。
// 必须删键，不能设空串（实测空串会让 Electron 直接 abort）。
delete env.ELECTRON_RUN_AS_NODE;

console.log(`[start-desktop] electron:   ${electron}`);
console.log(`[start-desktop] config url: ${env.DSH_PET_CONFIG_URL}`);

const child = spawn(electron, [helperMain], { env, stdio: 'inherit', windowsHide: false });
child.on('exit', (code, signal) => {
  console.log(`[start-desktop] helper exited (code=${String(code)}, signal=${String(signal)})`);
});
