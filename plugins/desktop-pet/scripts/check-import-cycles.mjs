/**
 * 相对导入环检测：src 内的模块图不得出现环。
 *
 * 为什么需要它：这次重构把 dispatchPetRoute 拆成 10 个路由模块、把 apply 拆成 8 个装配模块，
 * 模块数量翻了几倍，靠人眼已经看不出环。类型检查不会报环（ESM 允许环，只是初始化时序脆弱），
 * 所以必须单独钉一条。
 *
 * 只统计运行时边：`import type` 与 `export type ... from` 在产物里被擦除，不构成运行期环，
 * 因此不计入（类型写成环是无害的）。
 *
 * 用法：node scripts/check-import-cycles.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SRC = 'src';

/** 收集 src 下所有 .ts/.tsx */
function collect(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

/**
 * 一个文件的运行时相对依赖。
 * @param file - 源文件路径。
 * @returns 目标文件路径列表（只含 src 内、且解析得到的相对导入）。
 */
function edgesOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out = [];
  const push = (spec, typeOnly) => {
    if (typeOnly || !spec.startsWith('.')) return;
    const abs = path.resolve(path.dirname(file), spec).replace(/\\/g, '/');
    const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
    if (rel.endsWith('.ts') || rel.endsWith('.tsx')) out.push(rel);
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const clause = st.importClause;
      // 整体 type-only 的 import 语句（import type { X } from '...'）不产生运行期边
      push(st.moduleSpecifier.text, Boolean(clause && clause.isTypeOnly));
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      push(st.moduleSpecifier.text, st.isTypeOnly);
    }
  }
  return out;
}

const files = collect(SRC);
const graph = new Map(files.map((f) => [f, edgesOf(f).filter((t) => files.includes(t))]));

/** 三色 DFS：灰 = 在当前栈上，遇到灰边即成环 */
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;
const color = new Map(files.map((f) => [f, WHITE]));
const stack = [];
const cycles = [];

function visit(node) {
  color.set(node, GRAY);
  stack.push(node);
  for (const next of graph.get(node) ?? []) {
    if (color.get(next) === GRAY) {
      const start = stack.indexOf(next);
      cycles.push([...stack.slice(start), next]);
    } else if (color.get(next) === WHITE) {
      visit(next);
    }
  }
  stack.pop();
  color.set(node, BLACK);
}

for (const f of files) if (color.get(f) === WHITE) visit(f);

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      { files: files.length, edges: [...graph.values()].reduce((n, l) => n + l.length, 0), cycles },
      null,
      2,
    ),
  );
} else if (cycles.length === 0) {
  console.log(
    `[check-import-cycles] ✓ ${files.length} 个模块、${[...graph.values()].reduce((n, l) => n + l.length, 0)} 条运行时边，无环`,
  );
} else {
  console.error(`[check-import-cycles] ✗ 发现 ${cycles.length} 个导入环：`);
  for (const cycle of cycles) {
    console.error('  ' + cycle.map((f) => path.relative(process.cwd(), f)).join(' -> '));
  }
  process.exit(1);
}
