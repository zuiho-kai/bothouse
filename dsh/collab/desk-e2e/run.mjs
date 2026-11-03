#!/usr/bin/env node
// 团队工作台端到端驱动（Issue #876 E 路）。
//
// 用法（在仓库根目录）：
//   node dsh/collab/desk-e2e/run.mjs                 # 全跑，产物留在临时目录，末尾打印路径
//   node dsh/collab/desk-e2e/run.mjs --out ./out    # 截图/录屏放到指定目录
//   PW_MODULE=/abs/path/to/playwright/index.mjs node dsh/collab/desk-e2e/run.mjs
//
// 它做四件事，按依赖顺序，缺一环就停在那环并说清楚缺什么：
//   1. 事件：临时 BOARD_DIR 下用真实 board.py 跑 add/update/returned/reject/pause/done，
//      检查 board-events.jsonl 的 kind/from/to 是否符合 Issue #876 的 Event contract。
//   2. 路由：最小宿主起插件，GET /collab/desk 必须是 200 的 HTML；不是就 FAIL。
//   3. 事件流：先等到 SSE 的 `: connected` 首帧，再写一条真实事件，15 秒内必须收到 type=task。
//   4. 画面：Playwright 打开页面，桌面 1440x900 与手机 390x844 各截图；再用回放模式录 15 秒。
//
// 隔离：HOME、BOTHOUSE_DATA_DIR、GATE_SETUP_DIR、BOARD_DIR、CC_BIN 全指向 mktemp 目录，
// 其中 CC_BIN 是一个假程序，保证 board.py 的 pause/done 不会碰真桥的定时器与工作区。
// 本脚本不删任何目录：产物与临时数据都留着，路径打在末尾。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from './host.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const BOARD_PY = join(REPO, 'bridge/contrib/gate/board.py');

const DESKTOP = { width: 1440, height: 900 }; // 来源：常见笔记本视口，够放办公室地图与右侧成员栏
const MOBILE = { width: 390, height: 844 };   // 来源：iPhone 14 逻辑分辨率（验收要求手机浏览器布局完整）
const VIDEO_SECONDS = 15;                     // 来源：Issue #876「15-second sample recording」
const EVENT_TIMEOUT_MS = 15_000;              // 来源：Issue #876 验收「within a few seconds」，留 15 秒余量

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// 不传 --out 时不能用 resolve('')：那会变成当前目录，把截图撒进仓库根。
const outArg = arg('--out', undefined);
const outDir = outArg ? resolve(outArg) : '';
const root = mkdtempSync(join(tmpdir(), 'desk-e2e-'));
const dirs = {
  root,
  home: join(root, 'home'),
  data: join(root, 'data'),
  gate: join(root, 'gate'),
  board: join(root, 'board'),
  ws: join(root, 'ws'),
  lead: join(root, 'bothouse/lead.json'),
  shots: outDir || join(root, 'out'),
};
for (const d of [dirs.home, dirs.data, dirs.gate, dirs.board, dirs.ws, dirname(dirs.lead), dirs.shots]) {
  mkdirSync(d, { recursive: true });
}

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  const mark = ok === true ? 'PASS' : ok === 'skip' ? 'SKIP' : 'FAIL';
  console.log(`[${mark}] ${step}${detail ? ` — ${detail}` : ''}`);
}

// 假 CC_BIN：board.py 会用它加/删定时器、列/领工作区。e2e 不能碰真桥，所以给个「什么也不做」的替身，
// --json 的调用回一个空数组，让调用方按「没有工作区 / 没有定时器」走。
const fakeCc = join(root, 'fake-cc.sh');
writeFileSync(fakeCc, '#!/bin/sh\ncase "$*" in *--json*) echo "[]" ;; esac\nexit 0\n');
chmodSync(fakeCc, 0o755);

/** 所有子进程都用这套环境：临时家目录 + 临时产品数据目录 + 假桥。 */
const env = {
  ...process.env,
  HOME: dirs.home,
  BOTHOUSE_DATA_DIR: join(root, 'bothouse'),
  GATE_SETUP_DIR: dirs.gate,
  CC_DATA_DIR: '',
  BOARD_DIR: dirs.board,
  CC_PROJECT: 'deep',
  CC_SESSION_KEY: '',
  CC_BIN: fakeCc,
};

/** 跑一条真实 board 命令；返回 stdout。 */
function board(...args) {
  return execFileSync('python3', [BOARD_PY, ...args], { encoding: 'utf8', env }).trim();
}

/** 任务板事件文件（board.py 写、插件读）。 */
function readEvents() {
  const file = join(dirs.board, 'board-events.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// ---------- 1. 事件层 ----------
console.log('== 1/4 任务板事件（真实 board.py，隔离的临时目录）==');
try {
  // 顺序按 board.py 的状态机走：交回（待验收）之后才能退回；暂停单开一条，免得和交回互相盖状态。
  const id1 = board('add', '端到端驱动：造一条真实派活', 'notes/desk/E.handoff.md', '排队', 'C酱', '--short', 'E2E派活一').replace('#', '');
  board('update', id1, '进行中', '', '肥鱼');       // 换人 -> assigned
  board('returned', id1, 'C酱');                    // 交回 -> returned
  board('reject', id1, '验收退回：截图缺手机视口');   // 退回 -> rejected
  board('returned', id1, 'C酱');
  board('done', id1, '1', '缺手机视口');             // 收尾 -> done
  const id2 = board('add', '端到端驱动：造一条暂停', 'notes/desk/E.handoff.md', '排队', 'C酱', '--short', 'E2E派活二').replace('#', '');
  board('pause', id2, '等用户定方向');              // 暂停 -> paused

  const events = readEvents();
  const kinds = new Set(events.map(e => e.kind));
  const missing = ['created', 'assigned', 'returned', 'rejected', 'paused', 'done'].filter(k => !kinds.has(k));
  const badShape = events.filter(e => !e.ts || !e.id || !e.kind || e.from === undefined || e.to === undefined || !e.title);
  if (events.length === 0) record('事件落盘', false, `${join(dirs.board, 'board-events.jsonl')} 不存在或为空`);
  else if (missing.length || badShape.length) record('事件落盘', false, `缺 kind: ${missing.join(',') || '无'}；字段不全 ${badShape.length} 条`);
  else record('事件落盘', true, `${events.length} 条，kind 齐全；from/to 示例 ${events[0].from}→${events[0].to}`);
} catch (error) {
  record('事件落盘', false, String(error.stderr || error.message).split('\n')[0]);
}

// ---------- 2. 路由 ----------
console.log('== 2/4 起最小宿主，看 /collab/desk ==');
let host;
let deskOk = false;
try {
  host = await startHost({ dataDir: dirs.data, workspacePath: dirs.ws, leadFile: dirs.lead, boardDir: dirs.board });
  record('插件启动', true, host.routes.map(r => r.path).join(', '));
  const desk = await fetch(`${host.url}/collab/desk`);
  const body = await desk.text();
  if (desk.status === 200 && /<html|<!doctype/i.test(body)) {
    deskOk = true;
    record('/collab/desk', true, `${desk.status}，${body.length} 字节`);
  } else {
    record('/collab/desk', false, `${desk.status}，不是 HTML 页面（路由缺失或坏了）`);
  }
  const state = await (await fetch(`${host.url}/collab/api/state`)).json();
  record('/collab/api/state', Array.isArray(state.members), `成员 ${state.members?.length ?? 0} 个`);
} catch (error) {
  record('插件启动', false, String(error.message).split('\n')[0]);
}

// ---------- 3. 事件流 ----------
async function waitTaskEvent(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const reader = res.body.getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return undefined;
      buffer += new TextDecoder().decode(value);
      // 按完整帧切：只处理以空行结尾的块，剩下的半帧留到下次；不能用 slice(1) 丢首字节。
      for (let i; (i = buffer.indexOf('\n\n')) >= 0;) {
        const frame = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (frame.startsWith(':')) continue;  // `: connected` / `: ping`
        const line = frame.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        let event;
        try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (event.type === 'task') return event;
      }
    }
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

if (host) {
  console.log('== 3/4 /collab/api/events 是否转发 task ==');
  const subscription = waitTaskEvent(`${host.url}/collab/api/events`, EVENT_TIMEOUT_MS);
  // 等订阅真的建立（服务端先发 `: connected`）再写事件，否则事件可能在没人听的时候就被尾随走。
  await new Promise(r => setTimeout(r, 1500));
  try {
    board('add', '端到端驱动：事件流探针', 'notes/desk/E.handoff.md', '排队', 'C酱', '--short', 'E2E探针');
  } catch (error) {
    record('task 事件转发', false, `造事件失败：${String(error.stderr || error.message).split('\n')[0]}`);
  }
  const task = await subscription;
  if (task) record('task 事件转发', true, `收到 type=task id=${task.id} kind=${task.kind}`);
  else record('task 事件转发', false, `${EVENT_TIMEOUT_MS / 1000}s 内没有 type=task（尾随或事件转发坏了）`);
}

// ---------- 4. 画面 ----------
async function loadPlaywright() {
  const spec = process.env.PW_MODULE || 'playwright';
  try {
    return await import(spec);
  } catch {
    return undefined;
  }
}

/** datetime-local 要的是本地时间、不带秒。 */
function localDatetime(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

/** 回放窗口：覆盖本轮造出来的全部事件，前后各留一分钟。 */
function replayWindow(list) {
  const times = list.map(e => Date.parse(e.ts)).filter(Number.isFinite);
  if (times.length === 0) return undefined;
  return { from: localDatetime(Math.min(...times) - 60_000), to: localDatetime(Math.max(...times) + 60_000) };
}

if (host && deskOk) {
  console.log('== 4/4 Playwright 截图与回放录屏 ==');
  const playwright = await loadPlaywright();
  if (playwright === undefined) {
    record('Playwright', 'skip', '没装：npm i -D playwright && npx playwright install chromium（或设 PW_MODULE 指向已装入口）');
  } else {
    const browser = await playwright.chromium.launch();
    try {
      // 截图：实时态，桌面与手机各一张。
      for (const [label, viewport, mobile] of [['desktop', DESKTOP, false], ['mobile', MOBILE, true]]) {
        const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${host.url}/collab/desk`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const shot = join(dirs.shots, `desk-${label}.png`);
        await page.screenshot({ path: shot });
        record(`截图 ${label}`, errors.length === 0, errors.length ? errors[0] : shot);
        await context.close();
      }

      // 录屏：回放模式 15 秒，桌面与手机各一段。
      const window = replayWindow(readEvents());
      if (window === undefined) {
        record('回放录屏', false, '没有事件可回放');
      } else {
        for (const [label, viewport, mobile] of [['desktop', DESKTOP, false], ['mobile', MOBILE, true]]) {
          const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, recordVideo: { dir: dirs.shots, size: viewport } });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', e => errors.push(String(e)));
          await page.goto(`${host.url}/collab/desk`, { waitUntil: 'domcontentloaded' });
          if (await page.locator('#modeReplay').count() === 0) {
            record(`回放录屏 ${label}`, false, '页面没有回放控件（是占位页？）');
            await context.close();
            continue;
          }
          await page.click('#modeReplay');
          await page.fill('#from', window.from);
          await page.fill('#to', window.to);
          await page.click('#loadReplay');
          await page.waitForTimeout(500);
          const play = page.locator('#playPause');
          if (await play.count()) await play.click().catch(() => {});
          await page.waitForTimeout(VIDEO_SECONDS * 1000 - 1000);
          const video = page.video();
          await context.close();
          record(`回放录屏 ${label}`, errors.length === 0, errors.length ? errors[0] : await video.path());
        }
      }
    } finally {
      await browser.close();
    }
  }
} else if (host) {
  record('Playwright', 'skip', '第 2 步没过，未跑画面');
}

await host?.close();

console.log('\n== 汇总 ==');
for (const r of results) console.log(`${r.ok === true ? 'PASS' : r.ok === 'skip' ? 'SKIP' : 'FAIL'}\t${r.step}\t${r.detail}`);
console.log(`产物目录：${dirs.shots}`);
console.log(`隔离数据：${dirs.root}（保留，不自动删）`);

const failed = results.filter(r => r.ok === false);
process.exit(failed.length ? 1 : 0);