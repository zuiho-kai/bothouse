// #114 渲染样张的真实浏览器核验：用本路专用无头 Chrome（CDP 9466）打开样张，
// 逐个按按钮、读回页面上的实测数值，再截桌面/手机、亮/暗图并录一段操作录屏。
// 只写本目录下的产物，不碰共享安装、不动别的路的浏览器。
// 默认直接打开本目录的 index.html（file://），这样验的就是「单发一个文件」的那份。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CDP = 'http://127.0.0.1:9466'; // 来源：本路专用 Chrome 调试端口（沿用原 #114 截图环境）
const URL_ = process.env.URL || pathToFileURL(join(HERE, 'index.html')).href;
const ORIGIN = new globalThis.URL(URL_).origin;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = join(HERE, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const tab = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('console: ' + m.params.entry.text);
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('page error: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
const click = (sel) => ev(`(()=>{const n=document.querySelector(${JSON.stringify(sel)}); if(!n) return false; n.click(); return true})()`);

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await fetch(`${CDP}/json/activate/${tab.id}`);
try {
  await send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
} catch (e) { errors.push('grantPermissions: ' + e.message); }

const DPR = 2; // 来源：沿用 #98 验收的 2 倍像素
async function viewport(w, h, mobile, scheme) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: DPR, mobile });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64'));
  return name + '.png';
}

const results = {};
await viewport(1440, 900, false, 'light');
await send('Page.navigate', { url: URL_ });
await send('Page.bringToFront'); // 后台标签页会把 requestAnimationFrame 节流，流式就量不到完整字数
await sleep(900);

results.seedMessages = await ev(`document.querySelectorAll('#log .msg').length`);
results.noHorizontalOverflow = await ev(`document.documentElement.scrollWidth <= innerWidth + 1`);
results.title = await ev(`document.title`);

// 1 长消息
await click('button[data-d="long"]'); await sleep(500);
results.long = await ev(`(()=>{const m=[...document.querySelectorAll('#log .msg')].pop();return {paras:m.querySelectorAll('.md-p').length, atBottom: Math.abs(log.scrollTop+log.clientHeight-log.scrollHeight)<=1}})()`);

// 真鼠标点击：headless 里 navigator.clipboard.writeText 要用户手势，脚本里的 .click() 不算。
async function mouseClickExpr(expr) {
  const box = await ev(`(()=>{const n=${expr}; if(!n) return null; const r=n.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}})()`);
  if (!box) return false;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  return true;
}

// 2 代码块 + 复制
await click('button[data-d="code"]'); await sleep(400);
results.code = await ev(`(()=>{const b=[...document.querySelectorAll('.md-pre')].pop(); const pre=b.querySelector('pre'); return {blocks:document.querySelectorAll('.md-pre').length, lang:b.querySelector('.md-lang').textContent, innerScroll: pre.scrollWidth>pre.clientWidth+1, scrollW: pre.scrollWidth, clientW: pre.clientWidth}})()`);
await mouseClickExpr(`[...document.querySelectorAll('.md-pre')].pop().querySelector('.md-copy')`);
await sleep(500);
results.copy = await ev(`(async()=>{const b=[...document.querySelectorAll('.md-pre')].pop(); const label=b.querySelector('.md-copy').textContent; let clip=''; try{clip=await navigator.clipboard.readText()}catch(e){clip='ERR '+e.message} return {label, clipChars: clip.length, clipHead: clip.slice(0,24)}})()`);

// 3 表格
await click('button[data-d="table"]'); await sleep(400);
results.table = await ev(`(()=>{const w=[...document.querySelectorAll('.md-table')].pop(); const r=w.getBoundingClientRect(); return {cols:w.querySelectorAll('th').length, rows:w.querySelectorAll('tbody tr').length, innerScroll: w.scrollWidth>w.clientWidth+1, pageOverflow: document.documentElement.scrollWidth>innerWidth+1}})()`);

// 4 图片 / 附件
await click('button[data-d="image"]'); await sleep(1200);
results.image = await ev(`(()=>{const i=[...document.querySelectorAll('.att-img img')].pop(); const f=[...document.querySelectorAll('.att-file')].pop(); return {natural: i? i.naturalWidth+'x'+i.naturalHeight : 'none', file: f? f.querySelector('.att-name').textContent : 'none', atBottom: Math.abs(log.scrollTop+log.clientHeight-log.scrollHeight)<=1}})()`);

// 5 引用回复
await click('button[data-d="quote"]'); await sleep(700);
results.quote = await ev(`(()=>{const q=[...document.querySelectorAll('.reply-quote')].pop(); return {exists: !!q, who: q? q.querySelector('.rq-who').textContent : ''}})()`);

// 6 流式：流式是按帧写进去的，等字数连续几次不再变化再量，避免量到半截。
await click('button[data-d="stream"]');
const streamChars = async () => ev(`(()=>{const m=[...document.querySelectorAll('#log .msg')].pop(); return m.querySelector('.body') ? m.querySelector('.body').textContent.length : 0})()`);
let lastChars = -1, stable = 0;
for (let i = 0; i < 100; i++) {
  await sleep(200);
  const n = await streamChars();
  stable = n === lastChars ? stable + 1 : 0;
  lastChars = n;
  if (stable >= 4) break; // 连续 4 次不再涨，算这次流式写完
}
results.stream = await ev(`(()=>{const m=[...document.querySelectorAll('#log .msg')].pop(); return {chars:m.querySelector('.body').textContent.length, gap: Math.round(log.scrollHeight-log.clientHeight-log.scrollTop)}})()`);

// 7 思考折叠
await click('button[data-d="think"]'); await sleep(400);
results.thinkCollapsed = await ev(`(()=>{const t=[...document.querySelectorAll('.think')].pop(); const btn=t.querySelector('.think-toggle'); const body=t.querySelector('.think-body > div'); return {label:btn.textContent.trim(), open: t.dataset.open==='true', bodyH: Math.round(body.getBoundingClientRect().height)}})()`);
await ev(`(()=>{const t=[...document.querySelectorAll('.think')].pop(); t.querySelector('.think-toggle').click();})()`);
await sleep(500);
results.thinkExpanded = await ev(`(()=>{const t=[...document.querySelectorAll('.think')].pop(); const body=t.querySelector('.think-body > div'); return {open: t.dataset.open==='true', bodyH: Math.round(body.getBoundingClientRect().height), chars: body.textContent.length}})()`);

// 8 工具事件
await click('button[data-d="tool"]'); await sleep(900);
results.tool = await ev(`(()=>{const rows=[...document.querySelectorAll('.tool-row')]; const first=rows[0]; const line=first.querySelector('.tool-line'); const r=line.getBoundingClientRect(); const p=first.getBoundingClientRect(); return {rows: rows.length, centered: Math.abs((r.left+r.right)/2 - (p.left+p.right)/2) < 2, fontSize: getComputedStyle(line).fontSize, color: getComputedStyle(line).color}})()`);

// 截图（亮 桌面）
const shotDesktopLight = await shot('desktop-light');

// 9 贴底与历史阅读
await click('button[data-d="stick"]'); await sleep(1000);
results.stick = await ev(`(()=>{const d=document.getElementById('dock'); return {dockShown: d.classList.contains('show'), dockText: d.textContent.trim(), gap: Math.round(log.scrollHeight-log.clientHeight-log.scrollTop)}})()`);
const shotDock = await shot('desktop-light-dock');
await ev(`document.getElementById('dock').click()`);
await sleep(600);
results.stickAfterJump = await ev(`(()=>{const d=document.getElementById('dock'); return {dockShown: d.classList.contains('show'), gap: Math.round(log.scrollHeight-log.clientHeight-log.scrollTop)}})()`);

// 暗色桌面
await ev(`document.documentElement.dataset.theme='dark'`);
await sleep(400);
const shotDesktopDark = await shot('desktop-dark');
await ev(`document.documentElement.dataset.theme='light'`);
await sleep(300);

// 手机宽（390）亮/暗
await viewport(390, 844, true, 'light');
await sleep(500);
const shotMobileLight = await shot('mobile-light');
results.mobile = await ev(`({vw: innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, appW: Math.round(document.getElementById('app').getBoundingClientRect().width)})`);
// 窄屏下再点一次表格：宽表应当只在自己内部横滚，整页不横滚
await click('button[data-d="table"]'); await sleep(400);
results.tableMobile = await ev(`(()=>{const w=[...document.querySelectorAll('.md-table')].pop(); return {innerScroll: w.scrollWidth>w.clientWidth+1, scrollW: w.scrollWidth, clientW: w.clientWidth, pageOverflow: document.documentElement.scrollWidth>innerWidth+1}})()`);
await ev(`document.documentElement.dataset.theme='dark'`);
await sleep(300);
const shotMobileDark = await shot('mobile-dark');
await ev(`document.documentElement.dataset.theme='light'`);

// 录屏：桌面亮，依次点 流式 / 思考 / 工具 / 贴底
await viewport(1280, 820, false, 'light');
await sleep(400);
await ev(`document.getElementById('clearBtn').click()`);
await sleep(500);
const recDir = join(HERE, 'rec');
fs.mkdirSync(recDir, { recursive: true });
let n = 0; const frames = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.screencastFrame') {
    fs.writeFileSync(join(recDir, 'f' + String(n++).padStart(5, '0') + '.jpg'), Buffer.from(m.params.data, 'base64'));
    if (frames.push(m.params.metadata.timestamp) && n > 900) return;
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  }
});
await send('Page.startScreencast', { format: 'jpeg', quality: 75 });
await sleep(300);
for (const d of ['stream', 'think', 'tool', 'stick']) { await click(`button[data-d="${d}"]`); await sleep(d === 'stream' ? 3200 : 1100); }
await send('Page.stopScreencast');
await sleep(300);
const recSeconds = frames.length > 1 ? frames.at(-1) - frames[0] : 0;
if (n > 1) {
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '12', '-i', join(recDir, 'f%05d.jpg'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(OUT, 'flow.mp4')]);
  } catch (e) { errors.push('ffmpeg: ' + e.message); }
}
results.recording = { frames: n, seconds: Number(recSeconds.toFixed(1)), mp4: fs.existsSync(join(OUT, 'flow.mp4')) ? 'shots/flow.mp4' : null };

results.shots = { desktopLight: shotDesktopLight, desktopDark: shotDesktopDark, dock: shotDock, mobileLight: shotMobileLight, mobileDark: shotMobileDark };
results.errors = errors;
fs.writeFileSync(join(HERE, 'verify.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await fetch(`${CDP}/json/close/${tab.id}`);
process.exit(0);
