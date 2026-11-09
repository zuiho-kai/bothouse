#!/usr/bin/env node
/**
 * 把 Electron 下载并解压到 $DSH_HOME/electron（默认 ~/.dsh/electron），供桌面 Helper 使用。
 *
 * 下载交给 @electron/get（URL 拼装、镜像、SHA256 校验、缓存复用），解压交给
 * @electron-internal/extract-zip（纯 Node + native，跨平台处理 symlink 与权限，不依赖系统 unzip/tar）。
 * 不做版本管理、不清理旧版本，也不拉起 Helper：可执行文件已存在就原样复用并直接返回。
 * 版本与镜像可由环境变量覆盖，落盘主目录由 DSH_HOME 决定，具体见 README。
 * 必须始终：解压后确认可执行文件真的存在，否则视为失败退出。
 * @module dsh-pet/scripts/ensure-electron
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { downloadArtifact } from '@electron/get';
import extract from '@electron-internal/extract-zip';

const HOME = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
const VERSION = process.env.DSH_PET_ELECTRON_VERSION || '43.3.0';
const MIRROR = process.env.DSH_PET_ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
const TARGET_DIR = resolve(HOME, 'electron');

const PLAT = process.platform;
const ELECTRON_REL =
  PLAT === 'win32'
    ? 'electron.exe'
    : PLAT === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron';
const EXE = join(TARGET_DIR, ELECTRON_REL);

/** 确保 Electron 就位：已存在即复用，否则下载解压并校验可执行文件。 */
async function main() {
  if (existsSync(EXE)) {
    console.log(EXE);
    return;
  }

  console.log(`[ensure-electron] Electron not found, downloading v${VERSION} (${PLAT}-${process.arch}) ...`);
  mkdirSync(TARGET_DIR, { recursive: true });

  const zipPath = await downloadArtifact({
    version: `v${VERSION}`,
    artifactName: 'electron',
    // platform/arch 不传：@electron/get 用宿主平台与架构自动推断
    mirrorOptions: { mirror: MIRROR.replace(/\/$/, '') + '/' },
    downloadOptions: { quiet: true },
  });
  await extract(zipPath, { dir: TARGET_DIR });
  if (!existsSync(EXE)) {
    throw new Error(`Electron zip extracted, but ${ELECTRON_REL} not found`);
  }
  console.log(EXE);
}

main().catch((error) => {
  console.error(`[ensure-electron] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
