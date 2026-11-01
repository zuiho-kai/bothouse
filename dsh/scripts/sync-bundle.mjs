#!/usr/bin/env node
// 把 dsh/ 的源码同步到内嵌镜像 bridge/core/dsh_bundle（#150）。
// 一键安装解包的是镜像，CI（bridge/core/dsh_bundle_sync_test.go）逐字节比对两边；本脚本负责让比对通过：
//
//   node dsh/scripts/sync-bundle.mjs               # 先按 pnpm-lock 重建前端 lib，再拷贝
//   node dsh/scripts/sync-bundle.mjs --skip-build  # 直接拷贝现有 lib（本机已经构建过时）
//   node dsh/scripts/sync-bundle.mjs --check       # 只跑 CI 的同一组检查
//
// 跳过规则与 Go 检查保持一致：.npmrc、package-lock.json、node_modules/ 和 test/ 不进镜像；
// 镜像里还没有的 *.test.mjs 留在源码侧，避免改一次 collab 就把新的回归套件塞进安装包。
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const MIRROR = 'bridge/core/dsh_bundle'
const SKIP_DIRS = new Set(['node_modules', 'test'])
const SKIP_FILES = new Set(['.npmrc', 'package-lock.json'])
const flags = new Set(process.argv.slice(2))
let copied = 0
let removed = 0

function walk(dir, prefix = '') {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out.sort()
}

function copyTree(fromRel, toRel) {
  const from = join(root, fromRel)
  const to = join(root, toRel)
  for (const rel of walk(from)) {
    const dst = join(to, rel)
    if (rel.endsWith('.test.mjs') && !existsSync(dst)) continue
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(join(from, rel), dst)
    copied += 1
  }
  // 镜像是生成物：源文件没了，镜像里的旧副本也不能继续随安装包发出去。
  for (const rel of walk(to)) {
    if (existsSync(join(from, rel))) continue
    rmSync(join(to, rel))
    removed += 1
  }
}

function copyFile(fromRel, toRel) {
  mkdirSync(dirname(join(root, toRel)), { recursive: true })
  copyFileSync(join(root, fromRel), join(root, toRel))
  copied += 1
}

// install.sh 故意不在这份同步里：内嵌副本带着安装时的 bundle 校验（#522），
// dsh/install.sh 带着 dsh-acp steer 补丁步骤，两边各自多一块，直接覆盖会删掉校验。
// 这里只在两者不一致时提醒，合并它们需要单独决定。
function warnInstallDrift() {
  const from = join(root, 'dsh/install.sh')
  const to = join(root, MIRROR, 'install.sh')
  if (!existsSync(from) || !existsSync(to)) return
  if (readFileSync(from).equals(readFileSync(to))) return
  console.warn('注意：dsh/install.sh 与内嵌 install.sh 不一致，本脚本不会覆盖内嵌副本（见脚本顶部说明）。')
}

function buildClient() {
  const cwd = join(root, 'dsh/packages/client-ui-discord')
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  execFileSync(pnpm, ['install', '--frozen-lockfile', '--ignore-workspace'], { cwd, stdio: 'inherit' })
  execFileSync(pnpm, ['run', 'bundle'], { cwd, stdio: 'inherit' })
}

function runGuard() {
  try {
    execFileSync('go', ['test', '-tags', 'no_web', './core', '-run', 'TestDSHBundle', '-count=1'], { cwd: join(root, 'bridge'), stdio: 'inherit' })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    console.error('没有找到 go，请手动运行：cd bridge && go test -tags no_web ./core -run TestDSHBundle')
    process.exitCode = 1
  }
}

if (flags.has('--check')) {
  runGuard()
} else {
  if (!flags.has('--skip-build')) buildClient()
  copyTree('dsh/collab', `${MIRROR}/collab`)
  warnInstallDrift()
  copyFile('dsh/packages/client-ui-discord/package.json', `${MIRROR}/packages/client-ui-discord/package.json`)
  copyTree('dsh/packages/client-ui-discord/lib', `${MIRROR}/packages/client-ui-discord/lib`)
  console.log(`同步完成：拷贝 ${copied} 个文件，删除 ${removed} 个过期文件`)
  console.log('校验：node dsh/scripts/sync-bundle.mjs --check')
}
