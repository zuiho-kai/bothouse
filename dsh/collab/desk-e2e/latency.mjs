#!/usr/bin/env node
// T 路：真派活延迟量测（Issue #876）。
// 在临时环境里用真实 board.py 走 派活→交回→打回→再交回→收尾，
// 每步记录「命令开始执行 → 页面画出对应光柱」的毫秒数；桌面与手机各一遍。
//
// 用法（仓库根目录）：node dsh/collab/desk-e2e/latency.mjs [--out <dir>]
//   PW_MODULE=/abs/path/to/playwright/index.mjs  装了 Playwright 时指路
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from './host.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const BOARD_PY = join(REPO, 'bridge/contrib/gate/board.py');
const LIMIT_MS = 5000;   // 门槛来自 C酱 派活原话：「延迟超过 5 秒…不达标」
const POLL_MS = 20;      // 轮询页面，20ms 足以分辨 5 秒门槛
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const outArg = arg('out', undefined);
const root = mkdtempSync(join(tmpdir(), 'desk-t-'));
const dirs = { home: join(root, 'home'), data: join(root, 'data'), ws: join(root, 'ws'), board: join(root, 'board'), gate: join(root, 'gate'), lead: join(root, 'bothouse/lead.json') };
for (const d of Object.values(dirs)) mkdirSync(dirname(d), { recursive: true });
mkdirSync(dirs.board, { recursive: true });
const outDir = outArg ? resolve(outArg) : join(root, 'out');
mkdirSync(outDir, { recursive: true });

// 假桥：board.py 的定时器与工作区命令全部落空，不碰真桥。
const fakeCc = join(root, 'fake-cc.sh');
writeFileSync(fakeCc, '#!/bin/sh\ncase "$*" in *--json*) echo "[]" ;; esac\nexit 0\n');
chmodSync(fakeCc, 0o755);
const env = { ...process.env, HOME: dirs.home, BOTHOUSE_DATA_DIR: join(root, 'bothouse'), GATE_SETUP_DIR: dirs.gate, CC_DATA_DIR: '', BOARD_DIR: dirs.board, CC_PROJECT: 'cj', CC_SESSION_KEY: '', CC_BIN: fakeCc };

const board = (...args) => execFileSync('python3', [BOARD_PY, ...args], { encoding: 'utf8', env }).trim().replace(/^#/, '');

async function loadPlaywright() {
  try { return await import(process.env.PW_MODULE || 'playwright'); } catch { return undefined; }
}

/** 等到某一类光柱出现；返回等了多久（毫秒），超出门槛返回 undefined。 */
async function waitBeam(page, cls, timeoutMs) {
  const start = Date.now();
  for (;;) {
    if (cls === null) return 0;
    if (await page.locator(`#beams .beam.${cls}`).count() > 0) return Date.now() - start;
    if (Date.now() - start > timeoutMs) return undefined;
    await page.waitForTimeout(POLL_MS);
  }
}

/** 等上一道光自然消失（2.7s 后自删），免得下一次数到旧的。 */
async function clearBeams(page) {
  for (let i = 0; i < 200; i++) {
    if (await page.locator('#beams .beam').count() === 0) return;
    await page.waitForTimeout(50);
  }
}

/** 一步：命令开始执行 → 页面画出该步对应的光。run 返回本步产物（比如任务编号）。 */
async function measure(page, label, cls, run) {
  await clearBeams(page);
  const t0 = Date.now();
  const value = run();
  const cmdMs = Date.now() - t0;
  const waited = await waitBeam(page, cls, LIMIT_MS);
  const total = Date.now() - t0;
  // 不只看节点在不在：量一下这道的路径条数与包围盒，证明真的画出了曲线而不是空壳。
  const geo = waited === undefined ? null : await page.evaluate(sel => {
    const g = document.querySelector(sel);
    if (!g) return null;
    const box = g.getBoundingClientRect();
    return { paths: g.querySelectorAll('path').length, w: Math.round(box.width), h: Math.round(box.height) };
  }, `#beams .beam.${cls}`);
  return { label, cls, cmdMs, total, ok: waited !== undefined && geo !== null && geo.paths >= 3 && geo.w > 0 && geo.h > 0, value, geo };
}

const playwright = await loadPlaywright();
if (playwright === undefined) {
  console.log('SKIP 没装 Playwright：npm i -D playwright && npx playwright install chromium（或用 PW_MODULE 指路）');
  process.exit(0);
}

const host = await startHost({
  dataDir: dirs.data, workspacePath: dirs.ws, leadFile: dirs.lead, boardDir: dirs.board,
  dshMembers: [
    { id: 'fish', name: '肥鱼', model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' }, rooms: [1] },
    { id: 'cj', name: 'C酱', model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' }, rooms: [1] },
  ],
});

const browser = await playwright.chromium.launch();
const rows = [];
try {
  for (const [view, viewport, mobile] of [['desktop', DESKTOP, false], ['mobile', MOBILE, true]]) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${host.url}/collab/desk`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#stage .seat').length >= 2, undefined, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);   // 页面的 SSE 订阅与首轮状态渲染先落定
    // 对照：不写任何事件，页面不该自己冒光；否则后面的延迟数字都不可信。
    await page.waitForTimeout(2000);
    const idle = await page.locator('#beams .beam').count();
    rows.push({ view, label: '对照 静止 2s（不该有光）', cmdMs: 0, total: 0, ok: idle === 0, note: idle ? `静止期冒出 ${idle} 道光` : undefined });

    const add = await measure(page, '派活 add', 'assign',
      () => board('add', `T 路延迟量测 ${view}`, 'notes/desk/T.sample.md', '排队', '肥鱼', '--short', '量测'));
    const id = add.value;
    await page.screenshot({ path: join(outDir, `beam-${view}.png`) });
    rows.push({ view, label: add.label, cmdMs: add.cmdMs, total: add.total, ok: add.ok, geo: add.geo });

    const back = await measure(page, '交回 returned', 'return', () => board('returned', id, 'C酱'));
    rows.push({ view, label: back.label, cmdMs: back.cmdMs, total: back.total, ok: back.ok, geo: back.geo });

    const reject = await measure(page, '打回 reject', 'reject', () => board('reject', id, 'T 路量测：打回'));
    rows.push({ view, label: reject.label, cmdMs: reject.cmdMs, total: reject.total, ok: reject.ok, geo: reject.geo });

    const back2 = await measure(page, '再交回 returned', 'return', () => board('returned', id, 'C酱'));
    rows.push({ view, label: back2.label, cmdMs: back2.cmdMs, total: back2.total, ok: back2.ok, geo: back2.geo });

    // 收尾按设计不画光：量命令耗时，并确认没有多画出一道。
    await clearBeams(page);
    const t0 = Date.now();
    board('done', id, '1', 'T 路延迟量测收尾');
    const doneMs = Date.now() - t0;
    await page.waitForTimeout(1500);
    const stray = await page.locator('#beams .beam').count();
    rows.push({ view, label: '收尾 done（无光按设计）', cmdMs: doneMs, total: doneMs, ok: stray === 0 && errors.length === 0, note: errors[0] });

    await context.close();
  }
} finally {
  await browser.close();
  await host.close();
}

for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}\t${r.view}\t${r.label}\t命令 ${r.cmdMs}ms\t总计 ${r.total}ms${r.geo ? `\t路径 ${r.geo.paths} 条 ${r.geo.w}×${r.geo.h}` : ''}${r.note ? `\t${r.note}` : ''}`);
writeFileSync(join(outDir, 'latency.json'), JSON.stringify({ generatedAt: new Date().toISOString(), limitMs: LIMIT_MS, rows }, null, 2));
console.log(`\n产物：${outDir}`);
console.log(`隔离数据：${root}（保留，不自动删）`);
process.exit(rows.every(r => r.ok) ? 0 : 1);