// #114 渲染路交互样张构建：从产品页 dsh/collab/page.html 里**原样抽取**渲染函数、正文更新逻辑、
// 渲染 CSS 与设计令牌，拼进 shell.html 生成自包含的 index.html。
//
// 为什么要抽而不是复制粘贴：样张必须演示「产品里真正跑的那份代码」，复制一份就会随时间漂移，
// 审稿的人也无法据此判断改动。抽出来的段落一旦在 page.html 里找不到，构建直接报错，不静默降级。
//
// 用法：node build.mjs [page.html 路径] [输出文件]   默认用同仓库的 dsh/collab/page.html，输出到本目录 index.html。
// 第二个参数用来给「修复前」的页面临时出一份对照样张（check.mjs 靠它做红/绿判定）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = process.argv[2] || join(HERE, '..', '..', 'page.html');
const OUT = process.argv[3] || join(HERE, 'index.html');
const html = readFileSync(PAGE, 'utf8');
const shell = readFileSync(join(HERE, 'shell.html'), 'utf8');

const fail = (what) => { console.error('build: 在 ' + PAGE + ' 里找不到' + what + '，拒绝生成样张'); process.exit(1); };

// 取一对大括号之间的内容（从 at 之后第一个 { 开始配对），用于抽 :root 令牌块。
function braced(src, at) {
  const start = src.indexOf('{', at);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start + 1, i);
  }
  return '';
}

// 一段以 from 开头、到 to（不含）结尾的源码。
function slice(from, to, what) {
  const a = html.indexOf(from);
  if (a < 0) fail(what + ' 的起点 ' + JSON.stringify(from));
  const b = to ? html.indexOf(to, a) : html.length;
  if (b < 0) fail(what + ' 的终点 ' + JSON.stringify(to));
  return html.slice(a, b);
}

// ---- 设计令牌：:root 是暗色一套，@media (prefers-color-scheme: light) 里是亮色一套 ----
// 样张要能一键切亮/暗，所以把两套都抽出来挂到 [data-theme] 上，不再依赖系统偏好。
const rootAt = html.indexOf(':root');
if (rootAt < 0) fail(' :root 令牌块');
const darkTokens = braced(html, rootAt);
const lightMediaAt = html.indexOf('@media (prefers-color-scheme: light)');
if (lightMediaAt < 0) fail(' 亮色 @media (prefers-color-scheme: light)');
const lightTokens = braced(html, html.indexOf(':root', lightMediaAt));
const tokensCSS = [
  '/* 以下令牌抽自 dsh/collab/page.html：:root 是完整一套（含字号、间距、圆角），亮色只覆盖颜色。 */',
  ':root {' + darkTokens + '}',
  ':root[data-theme="dark"] { color-scheme: dark; }',
  ':root[data-theme="light"] {' + lightTokens + '}',
].join('\n');

// ---- 消息行 / 任务卡 / Markdown 三组渲染样式 ----
const msgCSS = slice('#log {', '/* 任务卡', ' 消息行样式');
const cardCSS = slice('/* 任务卡', '/* ---------- 成员', ' 任务卡样式');
const renderCSS = slice('/* ---- 消息正文 Markdown', '</style>', ' 正文渲染样式');

// ---- 渲染函数：Markdown 子集、附件、引用 ----
const renderCore = slice('// ---- 消息正文渲染 ----', '// 贴底跟随', ' 渲染函数');
// ---- 贴底跟随与贴底判定（产品页里的 keepBottom / stuck / followBottom）----
const followSrc = slice('// 贴底跟随', 'const messageSig', ' 贴底跟随');
// ---- 单条消息的组装（头像、昵称、卡片、引用、附件）----
const messageNodeSrc = slice('const messageSig', '// 同一人连续发言', ' messageNode');
// ---- 连续发言归组与消息流写入（regroup / patchBody / upsert）：正在增长的正文由这里原地更新 ----
const groupSrc = slice('// 同一人连续发言', 'async function api', ' regroup 与 upsert');
const groupWindowSrc = (html.match(/const GROUP_WINDOW_MS = [^;]+;/) || [null])[0];
if (!groupWindowSrc) fail(' GROUP_WINDOW_MS');
const cardStateSrc = (html.match(/const cardStateLabel = \{[^}]*\};/) || [null])[0];
if (!cardStateSrc) fail(' cardStateLabel');

// ---- 演示附件：做成构建期内嵌的 fixture ----
// 产品 attachmentList() 拼的是 /collab/api/attachments/<id>，要有宿主回落才能显示。单发一个 index.html
// 时没有宿主，所以这里把演示用的图片和文件内嵌进页面，运行时换成 blob: 网址——只换网址，
// 抽取的产品渲染函数一个字都不改。这些是演示素材，不是后端实测。
const fixtures = [
  { id: 'shot.png', name: 'shot.png', mime: 'image/png' },
  { id: 'report.pdf', name: '验收报告.pdf', mime: 'application/pdf' },
].map(f => {
  const bytes = readFileSync(join(HERE, 'assets', f.id));
  return { ...f, size: bytes.length, data: bytes.toString('base64') };
});
const fixtureSrc = 'const FIXTURE_ATTACHMENTS = [\n'
  + fixtures.map(f => '  { id: ' + JSON.stringify(f.id) + ', name: ' + JSON.stringify(f.name)
    + ', mime: ' + JSON.stringify(f.mime) + ', size: ' + f.size + ', data: ' + JSON.stringify(f.data) + ' },').join('\n')
  + '\n];';

// 用函数式替换：抽出来的代码里有模板字符串（${...} / `），走字符串替换会被当成 $ 特殊模式。
const fill = (src, key, text) => src.replace('/*{{' + key + '}}*/', () => text);
let out = shell;
out = fill(out, 'TOKENS', tokensCSS);
out = fill(out, 'MSG_CSS', msgCSS);
out = fill(out, 'CARD_CSS', cardCSS);
out = fill(out, 'RENDER_CSS', renderCSS);
out = fill(out, 'CARD_STATE', cardStateSrc);
out = fill(out, 'GROUP_WINDOW', groupWindowSrc);
out = fill(out, 'FIXTURES', fixtureSrc);
out = fill(out, 'RENDER_CORE', renderCore);
out = fill(out, 'FOLLOW', followSrc);
out = fill(out, 'MESSAGE_NODE', messageNodeSrc);
out = fill(out, 'GROUP_SRC', groupSrc);

if (out.includes('{{')) fail(' 未替换的占位符');

writeFileSync(OUT, out);
console.log('built ' + OUT + '  (' + out.length + ' bytes, from ' + PAGE + ')');
