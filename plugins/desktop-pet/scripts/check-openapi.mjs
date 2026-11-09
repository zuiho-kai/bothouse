/**
 * OpenAPI 文档校验，随发布链的 prepack 门禁运行：YAML 可解析、所有 $ref 都能解析到、
 * 路径/操作/响应符合 3.1 基本要求、文档里每条路径都真实存在于宿主半侧的路由实现里（防文档漂移）。
 * 只做静态比对，不起服务、不发请求，也不校验示例内容的语义。
 * 路径一律从本文件位置解析而非 CWD：文档在仓库根，本文件在 dsh-pet/scripts/。
 * 必须始终：任何一项失败都以非零退出码结束，坏文档不能进发布链。
 * @module dsh-pet/scripts/check-openapi
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const HERE = dirname(fileURLToPath(import.meta.url)); // dsh-pet/scripts
const SPEC_PATH = join(HERE, '..', '..', 'openapi.yaml'); // 仓库根
const ROUTES_DIR = join(HERE, '..', 'src', 'host', 'routes');

const doc = yaml.load(readFileSync(SPEC_PATH, 'utf8'));
const fail = [];
const ok = [];

if (doc.openapi !== '3.1.0') fail.push(`openapi 版本应为 3.1.0，实际 ${doc.openapi}`);
else ok.push('openapi 3.1.0');
for (const key of ['info', 'paths', 'components', 'servers', 'tags']) {
  if (!doc[key]) fail.push(`缺少顶层字段 ${key}`);
}
if (!doc.info?.title || !doc.info?.version) fail.push('info.title / info.version 缺失');

/** 按 JSON Pointer 解析文档内引用（含 ~1/~0 反转义），解析不到返回 undefined。 */
const deref = (ref) => {
  if (!ref.startsWith('#/')) return undefined;
  let cur = doc;
  for (const seg of ref.slice(2).split('/')) {
    cur = cur?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (cur === undefined) return undefined;
  }
  return cur;
};
let refCount = 0;
/** 深度遍历文档，逐个校验 $ref 可解析并计数。 */
const walk = (node, path) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') {
      refCount++;
      if (deref(v) === undefined) fail.push(`悬空 $ref: ${v}（位于 ${path}）`);
    } else walk(v, `${path}.${k}`);
  }
};
walk(doc, '$');
ok.push(`${refCount} 个 $ref 全部可解析`);

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
let ops = 0;
for (const [p, item] of Object.entries(doc.paths)) {
  if (!p.startsWith('/dsh-pet-7340')) fail.push(`路径未使用 /dsh-pet-7340 前缀: ${p}`);
  const keys = Object.keys(item).filter((k) => METHODS.includes(k));
  if (keys.length === 0) fail.push(`${p} 没有任何操作`);
  for (const m of keys) {
    ops++;
    const op = item[m];
    if (!op.operationId) fail.push(`${m.toUpperCase()} ${p} 缺少 operationId`);
    if (!op.summary) fail.push(`${m.toUpperCase()} ${p} 缺少 summary`);
    if (!Array.isArray(op.tags) || !op.tags.length) fail.push(`${m.toUpperCase()} ${p} 缺少 tags`);
    else
      for (const t of op.tags) {
        if (!doc.tags.some((x) => x.name === t)) fail.push(`${m.toUpperCase()} ${p} 的 tag「${t}」未在顶层声明`);
      }
    if (!op.responses || !Object.keys(op.responses).length) fail.push(`${m.toUpperCase()} ${p} 缺少 responses`);
    for (const [code, r] of Object.entries(op.responses ?? {})) {
      if (!/^[1-5](\d\d|XX)$/.test(code)) fail.push(`${m.toUpperCase()} ${p} 响应码非法: ${code}`);
      if (!r.description && !r.$ref) fail.push(`${m.toUpperCase()} ${p} 响应 ${code} 缺少 description`);
    }
    // 内联参数必须自带 name/in，否则路由无法绑定；$ref 参数交给上面的悬空引用检查。
    for (const prm of op.parameters ?? []) {
      if (prm.$ref === undefined && (!prm.name || !prm.in)) fail.push(`${m.toUpperCase()} ${p} 的参数缺少 name/in`);
    }
  }
}
ok.push(`${Object.keys(doc.paths).length} 条路径 / ${ops} 个操作`);

// 宿主半侧的路由分派在各领域处理器里：精确匹配写 `rest === 'x'`，rest 可能是两段（config/meta）；
// 素材领域按一级段兜底，写 `scope === 'x'`。所以两侧都归一化成一级段再比对，否则会互相误报。
// 逐个处理器扫而不是只看分发器：分发器只列处理器，段名都在各自文件里。
// 必须递归：领域处理器按子目录分（如 routes/config/），只扫一层会把子目录里的 rest 分支漏掉，
// 于是「文档里有、实现也在」被误报成实现缺失。
const routeSources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeSources(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });

const implemented = new Set();
for (const file of routeSources(ROUTES_DIR)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/rest === '([^']+)'/g)) implemented.add(m[1].split('/')[0]);
  // 素材领域既有正向分支，也有反向守卫（`scope !== 'thumb'` 才是 thumb 分支），两种都算。
  for (const m of src.matchAll(/scope (?:===|!==) '([^']+)'/g)) implemented.add(m[1]);
}
const documented = new Set();
for (const p of Object.keys(doc.paths)) {
  const seg = p.slice('/dsh-pet-7340/'.length).split('/')[0];
  if (seg && !seg.startsWith('{')) documented.add(seg);
}
for (const seg of documented) {
  if (!implemented.has(seg)) fail.push(`文档里的 /${seg} 在 host 路由实现中不存在`);
}
for (const seg of implemented) {
  if (!documented.has(seg)) fail.push(`host 实现了 /${seg}，但文档里没有`);
}
ok.push(`路由对齐：${[...documented].sort().join(', ')}`);

// 组件 schema 要么自带类型组合、要么引用别处，否则消费者无法据此生成代码。
for (const [name, s] of Object.entries(doc.components.schemas)) {
  if (!s || typeof s !== 'object') fail.push(`schema ${name} 不是对象`);
  if (!s.type && !s.oneOf && !s.allOf && !s.anyOf && !s.$ref) fail.push(`schema ${name} 没有 type/oneOf`);
}

console.log('通过：');
for (const l of ok) console.log('  ✓ ' + l);
if (fail.length) {
  console.log('\n失败：');
  for (const l of fail) console.log('  ✗ ' + l);
  process.exit(1);
}
console.log('\nOpenAPI 文档校验全部通过。');
