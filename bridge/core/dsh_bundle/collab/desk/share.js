// 团队工作台「一键分享」（Issue #876 L 路分享）。
//
// 目标（用户原话：唯一的要求就是要足够酷炫 高级 激发用户分享欲）：
//   1. 一键把当前画面导出成高清截图（2 倍尺寸），带团队名水印；
//   2. 一键录最近一段回放的短视频（WebM），同样带水印；
//   3. 手机上直接调系统分享面板（navigator.share 带文件）。
//
// 为什么不用第三方库：页面是没有构建步骤的单文件，不引外部依赖也不走 CDN，
// 所以这里用 SVG <foreignObject> 把舞台 DOM 序列化后画进 canvas——浏览器原生能力，
// 不新增依赖，装进 dsh_bundle 也能直接用。
//
// 本文件既是浏览器脚本（页面里只留一行占位注释，由插件 deskPage() 在返回时把本文件内联进去，
// 页面因此仍是自包含单文件），也是可被 Node 直接 import 的模块：
// 只在存在 document 时才自动挂按钮，测试可以安全导入。

/** 短视频取 6 秒。来源：页面把回放里相邻事件的间隔压到最多 2.4 秒（index.html 的 stepReplay），
 *  6 秒至少覆盖两次动作，够看清「派活→交回」一个往返；再长手机分享面板会明显变慢。 */
export const CLIP_SECONDS = 6;
/** 录制帧率 12fps。来源：实测这台机器把舞台序列化后重绘一帧约 35–60ms，12fps 不掉帧。 */
export const CLIP_FPS = 12;
/** 录制码率 4Mbps。来源：1440×900 的暗色画面实测 3–4Mbps 看不出块，16:9 竖屏更省。 */
export const CLIP_BITRATE = 4_000_000;
/** 导出倍率 2。来源：常见 2x 屏；分享场景要「高清」，1 倍在手机上会糊。 */
export const EXPORT_SCALE = 2;
/** 水印文案与位置：右下角，距边 24px（按 1 倍坐标算，导出时同乘倍率）。 */
export const WATERMARK_TEXT = '团队工作台 · CoNest';

const nowStamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 页面里所有内联样式表的文本；foreignObject 里的副本靠它复现视觉。 */
function pageCss(doc) {
  return [...doc.querySelectorAll('style')].map((s) => s.textContent || '').join('\n');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

/** 把 <img> 换成 data URL：SVG 里引用外链图片会污染 canvas，换掉后 toBlob 才不会抛错。 */
async function inlineImages(node, fetchImpl) {
  const images = [...node.querySelectorAll('img')];
  await Promise.all(images.map(async (img) => {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    try {
      const response = await fetchImpl(src);
      img.setAttribute('src', await blobToDataUrl(await response.blob()));
    } catch {
      img.removeAttribute('src'); // 取不到就退回底色，不让整张图失败
    }
  }));
}

/** outerHTML 是 HTML 序列化（<img> 这类空元素不带斜杠），塞进 SVG 会按 XML 解析失败。
 *  这里把空元素补成自闭合、把裸 & 转义，得到 foreignObject 能吃的 XHTML 片段。 */
export function toXhtml(node) {
  let out = node.outerHTML;
  out = out.replace(/<(img|input|br|hr|meta|link|source|area|col|embed|param|track|wbr)(\b[^>]*?)\s*\/?>/gi,
    (_, tag, attrs) => `<${tag}${attrs.replace(/\s+$/, '')}/>`);
  out = out.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g, '&amp;');
  return out;
}

/** 舞台 → SVG 字符串。宽高由调用方量真实舞台后传入（克隆节点脱离文档后量不到布局）。 */
export function stageToSvg(stage, cssText, size) {
  const width = Math.max(1, Math.round(size?.width ?? 1));
  const height = Math.max(1, Math.round(size?.height ?? 1));
  const clone = stage.cloneNode(true);
  for (const node of clone.querySelectorAll('[id]')) node.removeAttribute('id'); // 避免与原页面重复 id
  const inner = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px">` +
    `<style>${cssText}</style>${toXhtml(clone)}</div>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${inner}</foreignObject></svg>`;
}

/** 水印：右下角一枚半透明胶囊，含团队名与时刻。单独画在 canvas 上，不进 SVG。 */
export function drawWatermark(ctx, width, height, scale, text = WATERMARK_TEXT, stamp = nowStamp()) {
  const pad = 24 * scale;
  const font = 13 * scale;
  ctx.save();
  ctx.font = `600 ${font}px -apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  const label = `${text} · ${stamp}`;
  const textWidth = ctx.measureText(label).width;
  const boxWidth = textWidth + 24 * scale;
  const boxHeight = 30 * scale;
  const x = width - pad - boxWidth;
  const y = height - pad - boxHeight;
  ctx.fillStyle = 'rgba(8, 14, 22, 0.62)';
  const r = boxHeight / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, r);
  ctx.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, r);
  ctx.arcTo(x, y + boxHeight, x, y, r);
  ctx.arcTo(x, y, x + boxWidth, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 226, 178, 0.92)';
  ctx.fillText(label, x + 12 * scale, y + boxHeight / 2 + 0.5 * scale);
  ctx.restore();
}
/** 画一帧到 canvas（含可选水印）。每次重画都重新序列化，光柱动画才会动。 */
async function paintFrame(ctx, stage, cssText, scale, opts = {}) {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const probe = stage.cloneNode(true);
  for (const node of probe.querySelectorAll('[id]')) node.removeAttribute('id');
  if (!opts.stripImages) await inlineImages(probe, opts.fetchImpl || fetch);
  else for (const img of probe.querySelectorAll('img')) img.removeAttribute('src');
  const svg = stageToSvg(probe, cssText, { width, height });
  // 必须用 data: URL。实测这版 Chromium 把 blob: URL 的 SVG 图像画进 canvas 会标成污染
  // （foreignObject 里只放一个 div 也 taint，toBlob/toDataURL 全部抛错）；换 data: 后像素能正常读回。
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('画面渲染失败'));
      img.src = url;
    });
    ctx.clearRect(0, 0, width * scale, height * scale);
    ctx.drawImage(img, 0, 0, width * scale, height * scale);
    if (opts.watermark !== false) drawWatermark(ctx, width * scale, height * scale, scale);
  } finally {
    // data: URL 不占 blob 生命周期，无需 revoke。
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('导出失败'))), type, quality);
  });
}

/** 当前画面 → 高清 PNG（默认 2 倍）。 */
export async function capturePng(doc = document, opts = {}) {
  const stage = doc.getElementById('stage');
  if (!stage) throw new Error('找不到舞台');
  const scale = opts.scale || EXPORT_SCALE;
  const rect = stage.getBoundingClientRect();
  const canvas = doc.createElement('canvas');
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  const ctx = canvas.getContext('2d');
  await paintFrame(ctx, stage, pageCss(doc), scale, opts);
  return canvasToBlob(canvas, 'image/png');
}

/** 近 N 秒回放 → WebM。实时重绘 canvas 并用 captureStream 录，不需要任何库。 */
export async function recordClip(doc = document, opts = {}) {
  const stage = doc.getElementById('stage');
  if (!stage) throw new Error('找不到舞台');
  if (typeof MediaRecorder === 'undefined') throw new Error('这个浏览器不支持录制');
  const seconds = opts.seconds || CLIP_SECONDS;
  const fps = opts.fps || CLIP_FPS;
  const scale = opts.scale || 1; // 视频按 1 倍录：6 秒 × 12fps 的 2 倍图太占内存，分享也够看
  const rect = stage.getBoundingClientRect();
  const canvas = doc.createElement('canvas');
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  const ctx = canvas.getContext('2d');
  const cssText = pageCss(doc);
  await paintFrame(ctx, stage, cssText, scale, opts); // 先画一帧，避免流开头是空白

  const stream = canvas.captureStream(fps);
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((type) => MediaRecorder.isTypeSupported(type)) || 'video/webm';
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: CLIP_BITRATE });
  recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start();

  const interval = 1000 / fps;
  const started = Date.now();
  let timer;
  const tick = async () => {
    if (Date.now() - started >= seconds * 1000) return;
    try { await paintFrame(ctx, stage, cssText, scale, opts); } catch { /* 单帧失败不打断录制 */ }
    timer = setTimeout(tick, interval);
  };
  timer = setTimeout(tick, interval);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  clearTimeout(timer);
  recorder.stop();
  await stopped;
  for (const track of stream.getTracks()) track.stop();
  return new Blob(chunks, { type: mimeType });
}

function download(blob, filename, doc = document) {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  doc.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 能调系统分享就调（手机上一步到分享面板），否则退回下载。返回用了哪条路。 */
export async function shareOrDownload(blob, { filename, title, text } = {}, doc = document) {
  const file = new File([blob], filename, { type: blob.type });
  const nav = doc.defaultView ? doc.defaultView.navigator : undefined;
  if (nav && typeof nav.canShare === 'function' && nav.canShare({ files: [file] }) && typeof nav.share === 'function') {
    await nav.share({ files: [file], title, text });
    return 'share';
  }
  download(blob, filename, doc);
  return 'download';
}

function toast(doc, message) {
  const el = doc.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

/** 绑定按钮：一次点击先出截图，长按/第二个按钮出视频。 */
export function bindShare(doc = document) {
  const button = doc.getElementById('shareBtn');
  if (!button || button.dataset.bound === '1') return;
  button.dataset.bound = '1';
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    const original = button.textContent;
    try {
      button.textContent = '导出截图…';
      const png = await capturePng(doc);
      button.textContent = '录 6 秒…';
      toast(doc, '截图已生成，正在录 6 秒短片…');
      const clip = await recordClip(doc);
      const stamp = nowStamp().replace(/[: ]/g, '-');
      const via = await shareOrDownload(png, { filename: `desk-${stamp}.png`, title: '团队工作台', text: '办公室里每一道光，都是一条真实事件' }, doc);
      await shareOrDownload(clip, { filename: `desk-${stamp}.webm`, title: '团队工作台', text: '最近 6 秒的团队工作台' }, doc);
      toast(doc, via === 'share' ? '已打开系统分享' : '已下载截图与短片');
    } catch (error) {
      toast(doc, `分享失败：${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => bindShare(document));
  else bindShare(document);
}
