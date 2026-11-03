#!/usr/bin/env node
// 团队工作台端到端驱动（Issue #876 E 路）。
//
// 用法（在仓库根目录）：
//   node dsh/collab/desk-e2e/run.mjs                 # 全跑，产出在临时目录，末尾打印路径
//   node dsh/collab/desk-e2e/run.mjs --out ./out    # 截图/录屏放到指定目录
//   node dsh/collab/desk-e2e/run.mjs --keep          # 保留临时数据目录，方便手查
//
// 它做四件事，按依赖顺序，缺一环就停在那环并说清楚缺什么：
//   1. 事件：临时 BOARD_DIR 下用真实 board.py 跑 add/update/pause/reject/returned/done，
//      检查 board-events.jsonl 的 kind/from/to 是否符合 Issue #876 的 Event contract（A 路）。
//   2. 路由：最小宿主起插件，GET /collab/desk 是否存在（B/C 路）。
//   3. 事件流：订阅 /collab/api/events，造一条真实事件，看有没有 type=task 转发（B 路）。
//   4. 画面：Playwright 打开页面，桌面 1440x900 与手机 390x844 各截图，另录 15 秒视频。
//      只在第 2 步过了才跑。
//
// 不碰线上：CONEST_COLLAB_DATA、BOARD_DIR、leadFile 全在 mktemp 目录里；不连桥、不发消息。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
// 页面路径可用 DESK_E2E_PAGE 覆盖：B/C 合入前拿现有的 /collab 自测截图录屏这段管道。
const PAGE = process.env.DESK_E2E_PAGE || '/collab/desk';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// 不传 --out 时不能用 resolve('')：那会变成当前目录，把截图撒进仓库根。
const outArg = arg('--out', undefined);
const outDir = outArg ? resolve(outArg) : '';
const keep = process.argv.includes('--keep');
const root = mkdtempSync(join(tmpdir(), 'desk-e2e-'));
const dirs = {
  root,
  data: join(root, 'data'),
  board: join(root, 'board'),
  ws: join(root, 'ws'),
  lead: join(root, 'lead.json'),
  shots: outDir || join(root, 'out'),
};
for (const d of [dirs.data, dirs.board, dirs.ws, dirs.shots]) mkdirSync(d, { recursive: true });

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  const mark = ok === true ? 'PASS' : ok === 'skip' ? 'SKIP' : 'FAIL';
  console.log(`[${mark}] ${step}${detail ? ` — ${detail}` : ''}`);
}

/** 跑一条真实 board 命令；返回 stdout。 */
function board(...args) {
  return execFileSync('python3', [BOARD_PY, ...args], {
    encoding: 'utf8',
    env: { ...process.env, BOARD_DIR: dirs.board, CC_PROJECT: 'deep', CC_SESSION_KEY: '' },
  }).trim();
}

/** 任务板事件文件（A 路写，B 路读）。 */
function readEvents() {
  const file = join(dirs.board, 'board-events.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// ---------- 1. 事件层（A 路） ----------
console.log('== 1/4 任务板事件（真实 board.py，临时 BOARD_DIR）==');
try {
  // 顺序按 board.py 的状态机走：交回（待验收）之后才能退回；暂停单开一条，免得和交回互相盖状态。
  const id1 = board('add', '端到端驱动：造一条真实派活', 'notes/desk/E.handoff.md', '排队', 'C酱', '--short', 'E2E派活一').replace('#', '');
  board('update', id1, '进行中', '', '肥鱼');   // 换人 -> assigned
  board('returned', id1, 'C酱');                // 交回 -> returned
  board('reject', id1, '验收退回：截图缺手机视口'); // 退回 -> rejected
  board('returned', id1, 'C酱');
  board('done', id1, '1', '缺手机视口');         // 收尾 -> done
  const id2 = board('add', '端到端驱动：造一条暂停', 'notes/desk/E.handoff.md', '排队', 'C酱', '--short', 'E2E派活二').replace('#', '');
  board('pause', id2, '等用户定方向');          // 暂停 -> paused

  const events = readEvents();
  const kinds = new Set(events.map(e => e.kind));
  const missing = ['created', 'assigned', 'returned', 'rejected', 'paused', 'done'].filter(k => !kinds.has(k));
  const badShape = events.filter(e => !e.ts || !e.id || !e.kind || e.from === undefined || e.to === undefined || !e.title);
  if (events.length === 0) {
    record('事件落盘', false, `${join(dirs.board, 'board-events.jsonl')} 不存在或为空（A 路未合入）`);
  } else if (missing.length || badShape.length) {
    record('事件落盘', false, `缺 kind: ${missing.join(',') || '无'}；字段不全 ${badShape.length} 条`);
  } else {
    record('事件落盘', true, `${events.length} 条，kind 齐全；from/to 示例 ${events[0].from}→${events[0].to}`);
  }
} catch (error) {
  record('事件落盘', false, String(error.stderr || error.message).split('\n')[0]);
}

// ---------- 2. 路由（B/C 路） ----------
console.log(`== 2/4 起最小宿主，看 ${PAGE} ==`);
let host;
let deskOk = false;
try {
  host = await startHost({ dataDir: dirs.data, workspacePath: dirs.ws, leadFile: dirs.lead, boardDir: dirs.board });
  record('插件启动', true, host.routes.map(r => r.path).join(', '));
  const desk = await fetch(`${host.url}${PAGE}`);
  const body = await desk.text();
  if (desk.status === 200 && /<html|<!doctype/i.test(body)) {
    deskOk = true;
    record(PAGE, true, `${desk.status}，${body.length} 字节`);
  } else {
    record(PAGE, 'skip', `${desk.status}（B/C 路未合入时正常，先按契约写、合了再跑画面）`);
  }
  const state = await (await fetch(`${host.url}/collab/api/state`)).json();
  record('/collab/api/state', Array.isArray(state.members), `成员 ${state.members?.length ?? 0} 个`);
} catch (error) {
  record('插件启动', false, String(error.message).split('\n')[0]);
}

// ---------- 3. 事件流（B 路） ----------
if (host) {
  console.log('== 3/4 /collab/api/events 是否转发 task ==');
  try {
    const controller = new AbortController();
    const sawTask = new Promise(resolveTask => {
      const timer = setTimeout(() => resolveTask(undefined), EVENT_TIMEOUT_MS);
      fetch(`${host.url}/collab/api/events`, { signal: controller.signal })
        .then(async res => {
          const reader = res.body.getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += new TextDecoder().decode(value);
            for (const chunk of buffer.split('\n\n')) {
              const line = chunk.split('\n').find(l => l.startsWith('data:'));
              if (!line) continue;
              try {
                const event = JSON.parse(line.slice(5).trim());
                if (event.type === 'task') { clearTimeout(timer); resolveTask(event); return; }
              } catch { /* 非 JSON 行忽略 */ }
            }
            buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
          }
        })
        .catch(() => { clearTimeout(timer); resolveTask(undefined); });
    });
    // 造一条新事件喂给 tailer：B 路合入后应转成 type=task
    board('add', '端到端驱动：事件流探针', 'notes/desk/E.handoff.md', '排队', 'C酱', '--short', 'E2E探针');
    const task = await sawTask;
    controller.abort();
    if (task) record('task 事件转发', true, `收到 type=task id=${task.id} kind=${task.kind}`);
    else record('task 事件转发', 'skip', `${EVENT_TIMEOUT_MS / 1000}s 内没有 type=task（B 路未合入）`);
  } catch (error) {
    record('task 事件转发', false, String(error.message).split('\n')[0]);
  }
}

// ---------- 4. 画面 ----------
if (host && deskOk) {
  console.log('== 4/4 Playwright 截图与录屏 ==');
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    try {
      playwright = await import('/Users/xinyangzhai/agents-demo/.pw/node_modules/playwright/index.mjs');
    } catch {
      record('Playwright', 'skip', '未安装 playwright（npm i -D playwright && npx playwright install chromium）');
    }
  }
  if (playwright) {
    const browser = await playwright.chromium.launch();
    try {
      for (const [label, viewport, mobile] of [['desktop', DESKTOP, false], ['mobile', MOBILE, true]]) {
        const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, recordVideo: { dir: dirs.shots, size: viewport } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${host.url}${PAGE}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const shot = join(dirs.shots, `desk-${label}.png`);
        await page.screenshot({ path: shot, fullPage: false });
        record(`截图 ${label}`, errors.length === 0, errors.length ? errors[0] : shot);
        // 录一段：先停 2 秒静默（验收要求「没事时安静」），再造一条真实事件看飞光
        await page.waitForTimeout(2000);
        try { board('add', `端到端驱动：${label} 录屏事件`, 'notes/desk/E.handoff.md', '排队', 'C酱', '--short', 'E2E录屏'); } catch { /* 板面对录像不致命 */ }
        await page.waitForTimeout(VIDEO_SECONDS * 1000 - 4000);
        const video = page.video();
        await context.close();
        const path = await video.path();
        record(`录屏 ${label}`, true, path);
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
console.log(`临时数据：${dirs.root}${keep ? '（--keep，保留）' : ''}`);
if (!keep) rmSync(root, { recursive: true, force: true });

const failed = results.filter(r => r.ok === false);
process.exit(failed.length ? 1 : 0);