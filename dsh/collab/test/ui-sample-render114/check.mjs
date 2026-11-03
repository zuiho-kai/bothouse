// #114 渲染样张的机器判定：用本路专用无头 Chrome（CDP 9466）打开**单文件** index.html（file://），
// 跑父级独立验收指出的五个场景，量出实际 DOM 身份与滚动位置，任何一项不对就以非 0 退出。
//
// 五个场景（对应交接里的回归要求）：
//   1 未变代码块后追加正文   2 正在增长的代码块   3 附件保持   4 重复事件   5 历史阅读不跳
// 判定用「节点是不是同一个」和「scrollLeft 有没有被清零」，不看截图，错了就是错。
//
// 用法：node check.mjs [index.html 路径]
//   默认 file:// 打本目录 index.html。对照「修复前」：
//     git show <修复前提交>:dsh/collab/page.html > /tmp/before-page.html
//     node build.mjs /tmp/before-page.html /tmp/before-index.html
//     node check.mjs /tmp/before-index.html      # 应当红
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CDP = 'http://127.0.0.1:9466'; // 来源：本路专用 Chrome 调试端口，沿用 #114 截图环境
const FILE = resolve(process.argv[2] || join(HERE, 'index.html'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tab = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = []; const requests = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
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

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(FILE).href });
await sleep(1200);

const out = { file: FILE, protocol: 'file:', checks: {}, errors };

// 1 + 2 未变代码块后追加正文、正在增长的代码块
out.checks.appendAfterCode = await ev(`(() => {
  const code = '\\u0060\\u0060\\u0060js\\nconst longValue = "' + 'x'.repeat(500) + '";\\n\\u0060\\u0060\\u0060';
  const id = 9000115;
  const m = { id, room_id: state.room, author_kind: 'role', author: 'm-gg', name: 'G哥', text: '现有代码块\\n\\n' + code, created_at: Math.floor(Date.now() / 1000), attachments: [] };
  upsert(m);
  const row = log.querySelector('[data-id="' + id + '"]');
  const pre = row.querySelector('pre');
  pre.scrollLeft = 100;
  const scrollBefore = pre.scrollLeft;
  m.text += '\\n\\n新到的一段正文';
  m.edited_at = Date.now();
  upsert(m);
  const row2 = log.querySelector('[data-id="' + id + '"]');
  const pre2 = row2.querySelector('pre');
  const res = { sameRow: row === row2, sameCodeBlock: pre === pre2, scrollBefore, scrollAfter: pre2.scrollLeft, codeWidth: pre2.scrollWidth, viewport: pre2.clientWidth };
  // 代码块自己在长：只换里面的字，节点和横滚位置都不动。
  pre2.scrollLeft = 120;
  const growBefore = pre2.scrollLeft;
  m.text = '现有代码块\\n\\n' + '\\u0060\\u0060\\u0060js\\nconst longValue = "' + 'x'.repeat(500) + '";\\nconst extra = 1;\\n\\u0060\\u0060\\u0060';
  m.edited_at = Date.now();
  upsert(m);
  const pre3 = log.querySelector('[data-id="' + id + '"] pre');
  res.growSameNode = pre3 === pre2;
  res.growScrollBefore = growBefore;
  res.growScrollAfter = pre3.scrollLeft;
  res.growHasExtra = pre3.textContent.includes('const extra = 1;');
  // 4 同一条事件再到一次：内容没变，不该重建、也不该多出一行。
  upsert(m);
  const pre4 = log.querySelector('[data-id="' + id + '"] pre');
  res.dupSameNode = pre4 === pre3;
  res.dupRows = log.querySelectorAll('[data-id="' + id + '"]').length;
  return res;
})()`);

// 3 附件保持：图片先加载完，再往同一条消息追加正文，图片节点、网址、尺寸都不能变。
await ev(`(() => {
  const id = 9000116;
  const m = { id, room_id: state.room, author_kind: 'role', author: 'm-gg', name: 'G哥', text: '截图和原图都在这', created_at: Math.floor(Date.now() / 1000), attachments: [
    { id: 'shot.png', name: 'shot.png', mime: 'image/png', size: 388701 },
    { id: 'report.pdf', name: '验收报告.pdf', mime: 'application/pdf', size: 721 },
  ] };
  say(m);
})()`);
for (let i = 0; i < 40; i++) {
  if (await ev(`(() => { const i = log.querySelector('[data-id="9000116"] .att-img img'); return !!(i && i.complete && i.naturalWidth); })()`)) break;
  await sleep(100);
}
out.checks.attachment = await ev(`(async () => {
  const row = log.querySelector('[data-id="9000116"]');
  const img = row.querySelector('.att-img img');
  const file = row.querySelector('.att-file');
  const srcBefore = img.getAttribute('src');
  const before = { natural: img.naturalWidth + 'x' + img.naturalHeight, srcScheme: srcBefore.split(':')[0], hrefScheme: (file.href || '').split(':')[0] };
  // 真的能取到字节：blob 网址的响应有内容，才算「图能加载、附件能下载」。
  const fileBlob = await (await fetch(file.href)).blob();
  const m = store.find(x => x.id === 9000116);
  m.text += '\\n\\n补一张截图说明。';
  m.edited_at = Date.now();
  pushMessage(m);
  const row2 = log.querySelector('[data-id="9000116"]');
  const img2 = row2.querySelector('.att-img img');
  return { ...before,
    sameImgNode: img2 === img,
    sameSrc: img2.getAttribute('src') === srcBefore,
    sameNatural: img2.naturalWidth === img.naturalWidth,
    fileBytes: fileBlob.size, fileType: fileBlob.type,
    rowSame: row2 === row };
})()`);

// 5 历史阅读不跳：翻到顶部后再来新消息，scrollTop 不能被拽走。
out.checks.history = await ev(`(() => {
  log.scrollTop = 0;
  stuck = false;
  const at = log.scrollTop;
  const id = 9000117;
  upsert({ id, room_id: state.room, author_kind: 'role', author: 'm-gg', name: 'G哥', text: '这条是在你往上翻的时候到的。', created_at: Math.floor(Date.now() / 1000), attachments: [] });
  return { scrollBefore: at, scrollAfter: log.scrollTop, moved: Math.abs(log.scrollTop - at) > 1 };
})()`);

// 单文件自洽：整个会话里除了这个文件和 blob:/data:，不该再往外要任何东西。
out.requests = [...new Set(requests)].map(u => ({ url: u.slice(0, 90), scheme: u.split(':')[0] }));
out.remoteRequests = out.requests.filter(r => !['file', 'blob', 'data', 'about'].includes(r.scheme));

const c = out.checks;
const want = {
  '未变代码块后追加正文：同一行': c.appendAfterCode.sameRow === true,
  '未变代码块后追加正文：代码块节点复用': c.appendAfterCode.sameCodeBlock === true,
  '未变代码块后追加正文：横滚位置保留': c.appendAfterCode.scrollAfter === c.appendAfterCode.scrollBefore && c.appendAfterCode.scrollBefore === 100,
  '增长的代码块：节点复用': c.appendAfterCode.growSameNode === true,
  '增长的代码块：横滚位置保留': c.appendAfterCode.growScrollAfter === c.appendAfterCode.growScrollBefore && c.appendAfterCode.growScrollBefore > 0,
  '增长的代码块：新内容已渲染': c.appendAfterCode.growHasExtra === true,
  '重复事件：不重建、不重复': c.appendAfterCode.dupSameNode === true && c.appendAfterCode.dupRows === 1,
  '附件：图片节点与网址不变': c.attachment.sameImgNode === true && c.attachment.sameSrc === true && c.attachment.sameNatural === true,
  '附件：单文件可下载（有字节）': c.attachment.fileBytes > 0 && c.attachment.hrefScheme === 'blob',
  '附件：图片本地加载': c.attachment.srcScheme === 'blob' && /^\d+x\d+$/.test(c.attachment.natural),
  '历史阅读：新消息不拽视野': c.history.moved === false,
  '单文件：没有外部请求': out.remoteRequests.length === 0,
};
out.pass = Object.entries(want).map(([k, ok]) => ({ check: k, ok }));
out.ok = out.pass.every(p => p.ok) && errors.length === 0;
console.log(JSON.stringify(out, null, 2));
await fetch(`${CDP}/json/close/${tab.id}`);
process.exit(out.ok ? 0 : 1);
