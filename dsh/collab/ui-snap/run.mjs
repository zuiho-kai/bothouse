// 截图回归（Issue #98 U7）。
//
// 只做测试，不改页面：用临时 HTTP 宿主把 dsh/collab/page.html 与
// dsh/collab/desk/index.html 喂固定状态，桌面 1440 / 手机 390 × 亮/暗各截一张，
// 与 baseline/ 下的基准图做像素差，并检查横向溢出和被裁切的文字。
//
// 浏览器用 puppeteer-core + 本机 Chrome；没装时整条跳过。更新基准：
//   PUPPETEER_MODULE=/abs/node_modules/puppeteer-core node dsh/collab/ui-snap/run.mjs --update
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COLLAB = resolve(HERE, '..');
const BASELINE = join(HERE, 'baseline');
const FIXTURE_VERSION = 1;

// 来源：U7 派活固定桌面 1440×900、手机 390×844；与 desk-e2e 的视口保持一致。
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];
const THEMES = ['light', 'dark'];

// 固定到 U7 开工当天下午，避免时钟、相对时间和回放默认窗口漂移。
const FIXED_NOW = Date.parse('2026-11-03T14:40:00+08:00');
const FIXED_CLOCK = '2026-11-03T14:40:00+08:00';

// 阈值来源：U7 派活要求「像素差超阈值报红」。本机 Chromium 连续三次截图实测逐像素差 0，
// 这里留 16/255 的单通道抗锯齿余量与 0.1% 像素占比；超过即报红并落 diff 图。
const PIXEL_DELTA = 16; // 来源：U7 派活要求像素差超阈值报红；本机三次截图实测逐像素差 0，留 16/255 抗锯齿余量。
const MAX_DIFF_RATIO = 0.001; // 来源：同上，0.1% 像素占比容忍字体栅格化。

const FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}';
const DATE_INIT = `(() => {
  const NativeDate = Date;
  const fixed = ${FIXED_NOW};
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  }
  window.Date = FixedDate;
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(res, body, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function loadPuppeteer() {
  const require = createRequire(import.meta.url);
  for (const spec of [process.env.PUPPETEER_MODULE, 'puppeteer-core']) {
    if (!spec) continue;
    try { const mod = require(spec); return mod.default ?? mod; } catch { /* next */ }
  }
  return undefined;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => p && existsSync(p));
}

/** 临时宿主：真实页面文件 + 固定的 state / 消息 / SSE，不拉插件、不碰任何产品目录。 */
async function startHost() {
  const channel = readFileSync(join(COLLAB, 'page.html'));
  const desk = readFileSync(join(COLLAB, 'desk/index.html'));
  const avatarDir = join(COLLAB, 'avatars');
  const at = Math.floor(FIXED_NOW / 1000);
  const state = {
    me: 'owner',
    lead_id: 'lead',
    effective_lead_id: 'lead',
    rooms: [{ id: 1, name: 'general', dispatch_mode: 'mixed' }],
    thinking: { 1: ['deep'] },
    members: [
      { id: 'lead', name: '队长', kind: 'dsh', online: true, avatar: 'orange' },
      {
        id: 'deep', name: '肥鱼', kind: 'dsh', online: true, avatar: 'whale',
        busy: true, busy_since: FIXED_CLOCK, busy_task: 'U7 截图回归',
        busy_chat: '工作区1', busy_chats: ['工作区1', '工作区2'], busy_count: 3,
        busy_items: [
          { project: 'deep', chat: '工作区1', task: 'U7 截图回归', since: FIXED_CLOCK },
          { project: 'deep', chat: '工作区2', task: '频道页断点', since: FIXED_CLOCK },
          { project: 'deep', chat: null, task: 'relay 会话', since: FIXED_CLOCK },
        ],
      },
      { id: 'cursor', name: 'Cursor', kind: 'dsh', online: true, avatar: '' },
      { id: 'grok', name: 'Grok', kind: 'bot', online: false, avatar: '' },
    ],
  };
  const messages = [
    { id: 1, room_id: 1, author: 'lead', author_kind: 'dsh', name: '队长', text: '今天把工作台的忙闲状态接上，频道页也一起过一遍。', created_at: at - 900 },
    { id: 2, room_id: 1, author: 'deep', author_kind: 'dsh', name: '肥鱼', text: '收到，先把桌面和手机的亮暗色截图跑起来。', created_at: at - 600 },
    {
      id: 3, room_id: 1, author: 'lead', author_kind: 'dsh', name: '队长',
      text: 'U7 已派给肥鱼，先做截图回归。', created_at: at - 300,
      card: JSON.stringify({ kind: 'task', state: 'working', title: '#98 U7 截图回归' }),
    },
  ];

  const sse = new Set();
  const sockets = new Set();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://ui-snap.invalid');
    const path = url.pathname;
    if (req.method !== 'GET') return json(res, { error: 'method not allowed' }, 405);
    if (path === '/collab' || path === '/collab/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(channel);
    }
    if (path === '/collab/desk') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(desk);
    }
    const avatar = /^\/collab\/avatars\/([a-z0-9_-]+\.png)$/.exec(path);
    if (avatar) {
      const file = join(avatarDir, avatar[1]);
      if (!existsSync(file)) return json(res, { error: 'not found' }, 404);
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      return res.end(readFileSync(file));
    }
    if (path === '/collab/api/state') return json(res, state);
    if (path === '/collab/api/rooms/1/mode') return json(res, { dispatch_mode: 'mixed' });
    if (path === '/collab/api/rooms/1/messages') {
      if (url.searchParams.has('after')) return json(res, { messages: [] });
      return json(res, { messages });
    }
    if (path === '/collab/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n');
      sse.add(res);
      req.on('close', () => sse.delete(res));
      return;
    }
    return json(res, { error: 'not found', path }, 404);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      for (const res of sse) res.end();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

/** 页面内检查：横向溢出 + 被 overflow:hidden/clip 祖先切掉的文字。 */
function collectChecks(page, pageName) {
  return page.evaluate((kind) => {
    const overflow = [];
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    if (docW > winW + 1) overflow.push(`document ${docW}px > viewport ${winW}px`);
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed') continue;
      if (r.right > winW + 2 && r.left < winW) {
        overflow.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].join('.') : ''} right=${Math.round(r.right)}`);
      }
      if (overflow.length >= 8) break;
    }

    const clipped = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const start = node.parentElement;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()];
      if (!rects.length) continue;
      let parent = start;
      while (parent && parent !== document.documentElement) {
        const s = getComputedStyle(parent);
        const pr = parent.getBoundingClientRect();
        const clipX = s.overflowX === 'hidden' || s.overflowX === 'clip';
        const clipY = s.overflowY === 'hidden' || s.overflowY === 'clip';
        if (!clipX && !clipY) { parent = parent.parentElement; continue; }
        // 省略号/行截断是显式设计，不算破裂裁切。
        if (s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none')) break;
        for (const rect of rects) {
          const hitX = clipX && (rect.right > pr.right + 2 || rect.left < pr.left - 2);
          const hitY = clipY && (rect.bottom > pr.bottom + 2 || rect.top < pr.top - 2);
          if (!hitX && !hitY) continue;
          const text = node.nodeValue.trim().slice(0, 24);
          const key = `${parent.tagName}.${parent.className}|${text}`;
          if (seen.has(key)) break;
          seen.add(key);
          clipped.push({
            text,
            parent: `${parent.tagName.toLowerCase()}${parent.id ? '#' + parent.id : ''}${parent.classList.length ? '.' + [...parent.classList].join('.') : ''}`,
            axis: hitX ? 'x' : 'y',
          });
          break;
        }
        if (clipped.length >= 8) break;
        parent = parent.parentElement;
      }
      if (clipped.length >= 8) break;
    }
    const channelMessages = document.querySelectorAll('#log .msg').length;
    const channelMembers = document.querySelectorAll('#members .member').length;
    const title = document.querySelector('#title')?.textContent ?? '';
    const seats = document.querySelectorAll('#seats .seat').length;
    const dom = kind === 'channel'
      ? { ok: channelMessages >= 3 && channelMembers >= 4 && title.includes('general'),
          detail: `消息 ${channelMessages}（期望≥3）、成员 ${channelMembers}（期望≥4）、标题「${title}」` }
      : { ok: seats >= 4 && document.querySelector('#empty')?.hidden === true && document.querySelector('#replayBar')?.hidden === true,
          detail: `工位 ${seats}（期望≥4）、空态隐藏 ${document.querySelector('#empty')?.hidden}、回放条隐藏 ${document.querySelector('#replayBar')?.hidden}` };
    return { overflow, clipped, docW, winW, dom };
  }, pageName);
}

/** 用浏览器 canvas 解码两张 PNG 并算差异；不额外引入图像库。 */
async function comparePng(browser, baseline, actual) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ({ a, b, delta }) => {
      const load = (src) => new Promise((ok, fail) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = fail;
        img.src = 'data:image/png;base64,' + src;
      });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { size: true, baseline: [ia.width, ia.height], actual: [ib.width, ib.height] };
      }
      const w = ia.width, h = ia.height;
      const ca = document.createElement('canvas'); ca.width = w; ca.height = h;
      const cb = document.createElement('canvas'); cb.width = w; cb.height = h;
      const xa = ca.getContext('2d', { willReadFrequently: true });
      const xb = cb.getContext('2d', { willReadFrequently: true });
      xa.drawImage(ia, 0, 0); xb.drawImage(ib, 0, 0);
      const da = xa.getImageData(0, 0, w, h).data;
      const db = xb.getImageData(0, 0, w, h).data;
      let changed = 0, maxDelta = 0;
      let minX = w, minY = h, maxX = 0, maxY = 0;
      const out = xa.createImageData(w, h);
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
        if (d > maxDelta) maxDelta = d;
        if (d > delta) {
          changed++;
          const p = i / 4, x = p % w, y = Math.floor(p / w);
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255;
        } else {
          out.data[i] = da[i]; out.data[i + 1] = da[i + 1]; out.data[i + 2] = da[i + 2]; out.data[i + 3] = 255;
        }
      }
      const ratio = changed / (w * h);
      let diffUrl = '';
      if (changed) {
        const dc = document.createElement('canvas'); dc.width = w; dc.height = h;
        dc.getContext('2d').putImageData(out, 0, 0);
        diffUrl = dc.toDataURL('image/png');
      }
      return {
        size: false, w, h, changed, ratio, maxDelta,
        bbox: changed ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
        diffUrl,
      };
    }, {
      a: baseline.toString('base64'),
      b: actual.toString('base64'),
      delta: PIXEL_DELTA,
    });
  } finally {
    await page.close();
  }
}

async function shoot(browser, url, viewport, theme, path, pageName) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    if (typeof page.emulateTimezone === 'function') await page.emulateTimezone('Asia/Shanghai');
    await page.evaluateOnNewDocument(DATE_INIT);
    await page.goto(url, { waitUntil: 'load' });
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete), { timeout: 2000 }).catch(() => {});
    await sleep(500);
    const checks = await collectChecks(page, pageName);
    await page.screenshot({ path, fullPage: true });
    return checks;
  } finally {
    await page.close();
  }
}

export async function runSnapshots({ update = false } = {}) {
  const puppeteer = loadPuppeteer();
  const executablePath = findChrome();
  if (!puppeteer) return { skip: '没装 puppeteer-core；设置 PUPPETEER_MODULE 指向已安装的 puppeteer-core 目录后重跑。' };
  if (!executablePath) return { skip: '没找到 Chrome/Chromium；设置 CHROME_PATH 后重跑。' };
  if (!update && !existsSync(join(BASELINE, 'manifest.json'))) {
    return { failures: [{ case: 'baseline', message: '缺基准图；先跑 node dsh/collab/ui-snap/run.mjs --update' }], results: [] };
  }

  const artifacts = mkdtempSync(join(tmpdir(), 'ui-snap-'));
  const host = await startHost();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    // --no-sandbox / --disable-dev-shm-usage：本机与 CI 容器里渲染进程没有命名空间权限，
    // 不带这两项时 newPage 之后 setViewport 直接 Session closed（实测 Chrome 156）。
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--lang=zh-CN', '--font-render-hinting=none'],
    env: { ...process.env, TZ: 'Asia/Shanghai', LANG: 'zh_CN.UTF-8' },
  });
  const failures = [];
  const results = [];
  try {
    if (update) mkdirSync(BASELINE, { recursive: true });
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        for (const [pageName, url] of [['channel', `${host.url}/collab`], ['desk', `${host.url}/collab/desk`]]) {
          const name = `${pageName}-${viewport.name}-${theme}`;
          const actualPath = update ? join(BASELINE, `${name}.png`) : join(artifacts, `${name}.png`);
          const checks = await shoot(browser, url, viewport, theme, actualPath, pageName);
          const record = { case: name, checks, diff: null };
          if (!checks.dom.ok) failures.push({ case: name, message: '页面没渲染出预期内容：' + checks.dom.detail });
          if (checks.overflow.length) failures.push({ case: name, message: '横向溢出：' + checks.overflow.join('；') });
          if (checks.clipped.length) failures.push({ case: name, message: '文字被裁切：' + checks.clipped.map((c) => `${c.text} @ ${c.parent}(${c.axis})`).join('；') });
          if (!update) {
            const baselinePath = join(BASELINE, `${name}.png`);
            const diff = await comparePng(browser, readFileSync(baselinePath), readFileSync(actualPath));
            record.diff = diff;
            if (diff.size) {
              failures.push({ case: name, message: `尺寸变了：基准 ${diff.baseline.join('×')}，实际 ${diff.actual.join('×')}` });
            } else if (diff.ratio > MAX_DIFF_RATIO) {
              let diffFile = '';
              if (diff.diffUrl) {
                diffFile = join(artifacts, `${name}-diff.png`);
                writeFileSync(diffFile, Buffer.from(diff.diffUrl.split(',')[1], 'base64'));
              }
              failures.push({
                case: name,
                message: `像素差 ${(diff.ratio * 100).toFixed(3)}% > ${(MAX_DIFF_RATIO * 100).toFixed(1)}%（${diff.changed} 像素，最大通道差 ${diff.maxDelta}${diff.bbox ? `，bbox ${diff.bbox.w}×${diff.bbox.h}` : ''}）${diffFile ? `；diff ${diffFile}` : ''}`,
              });
            }
          }
          results.push(record);
        }
      }
    }
    if (update) {
      const version = await browser.version();
      writeFileSync(join(BASELINE, 'manifest.json'), JSON.stringify({
        version: 1, fixtureVersion: FIXTURE_VERSION, generatedAt: new Date().toISOString(),
        platform: process.platform, arch: process.arch, browser: version,
        fixedClock: FIXED_CLOCK, viewports: VIEWPORTS.map((v) => v.name), themes: THEMES,
        pixelDelta: PIXEL_DELTA, maxDiffRatio: MAX_DIFF_RATIO,
      }, null, 2) + '\n');
    }
  } finally {
    await browser.close();
    await host.close();
  }
  return { skip: undefined, failures, results, artifacts };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const update = process.argv.includes('--update');
  const result = await runSnapshots({ update });
  if (result.skip) {
    console.log('SKIP ' + result.skip);
  } else {
    for (const record of result.results) {
      const diff = record.diff && !record.diff.size ? `像素差 ${(record.diff.ratio * 100).toFixed(3)}%` : '';
      console.log(`${record.checks.overflow.length || record.checks.clipped.length || (record.diff && record.diff.ratio > MAX_DIFF_RATIO) ? 'FAIL' : 'PASS'} ${record.case}${diff ? ' — ' + diff : ''}`);
    }
    for (const failure of result.failures) console.log(`FAIL ${failure.case} — ${failure.message}`);
    console.log(`artifacts: ${result.artifacts}`);
    if (update) console.log(`baseline: ${BASELINE}`);
    process.exitCode = result.failures.length ? 1 : 0;
  }
}
