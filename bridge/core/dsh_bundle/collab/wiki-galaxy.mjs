// Wiki 星河：把一本 markdown wiki 画成星系。每页一颗星，[[链接]] 与相对 .md 链接是连线，
// 顶层目录是星团。只读：只扫配置的 wiki 目录，不写任何文件，不跟符号链接出目录。
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, posix, sep } from 'node:path';

// 来源：用户要求「点一颗星能看到这页标题、描述和前几行」（交接 wiki-galaxy-1103 总目标）。
export const EXCERPT_LINES = 5;

const WIKI_LINK = /\[\[([^\]\n]+?)\]\]/g;
const MD_LINK = /\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/g;
const HTML = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

/** 去掉 frontmatter，返回 { meta, body }；只认顶层 name/description 两个键。 */
export function splitFrontmatter(text) {
  const meta = {};
  if (!text.startsWith('---\n')) return { meta, body: text };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { meta, body: text };
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^(name|description):\s*(.*)$/.exec(line);
    if (m) meta[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const after = text.indexOf('\n', end + 1);
  return { meta, body: after < 0 ? '' : text.slice(after + 1) };
}

function walk(root, rel, out) {
  let entries;
  try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    // 不跟符号链接：wiki 目录外的东西一律不读。
    if (entry.isSymbolicLink()) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, child, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(child);
  }
}

/** 扫 wiki 目录，出 { nodes, links, groups }。 */
export function scanWiki(root) {
  const files = [];
  walk(root, '', files);
  const nodes = [];
  const bodies = [];
  for (const path of files) {
    let text;
    try { text = readFileSync(join(root, path), 'utf8'); } catch { continue; }
    const { meta, body } = splitFrontmatter(text);
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const parts = path.split('/');
    const excerpt = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).slice(0, EXCERPT_LINES).join('\n');
    nodes.push({
      id: path,
      name: meta.name || basename(path, '.md'),
      title: heading || meta.name || basename(path, '.md'),
      description: meta.description ?? '',
      group: parts.length > 1 ? parts[0] : '',
      cluster: parts.slice(0, -1).join('/'),
      lines: text.split('\n').length,
      excerpt,
    });
    bodies.push(body);
  }

  // [[name]] 先按 frontmatter name，再按文件名；README 也能用目录名指到。
  const byName = new Map();
  const claim = (key, id) => { if (key && !byName.has(key)) byName.set(key, id); };
  for (const n of nodes) claim(n.name, n.id);
  for (const n of nodes) claim(basename(n.id, '.md'), n.id);
  for (const n of nodes) if (basename(n.id) === 'README.md' && n.cluster) claim(basename(n.cluster), n.id);
  const ids = new Set(nodes.map(n => n.id));

  const seen = new Set();
  const links = [];
  const add = (source, target) => {
    if (!target || source === target) return;
    const key = source < target ? `${source}\n${target}` : `${target}\n${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source, target });
  };
  nodes.forEach((n, i) => {
    for (const m of bodies[i].matchAll(WIKI_LINK)) add(n.id, byName.get(m[1].split(/[|#]/)[0].trim()));
    for (const m of bodies[i].matchAll(MD_LINK)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      let target;
      try { target = posix.normalize(posix.join(posix.dirname(n.id), decodeURI(m[1]))); } catch { continue; }
      if (ids.has(target)) add(n.id, target);
    }
  });

  const groups = {};
  for (const n of nodes) groups[n.group] = (groups[n.group] ?? 0) + 1;
  return { nodes, links, groups };
}

export function wikiGalaxyPage() {
  return readFileSync(new URL('./wiki-galaxy/index.html', import.meta.url), 'utf8');
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/** /collab/wiki-galaxy 与 /collab/api/wiki-galaxy；返回 true 表示已处理，未匹配返回 undefined。 */
export function wikiGalaxyRoute(req, res, url, { wikiDir }) {
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '/collab/wiki-galaxy' && path !== '/collab/api/wiki-galaxy') return undefined;
  if (req.method !== 'GET') return undefined;
  if (path === '/collab/wiki-galaxy') {
    send(res, 200, HTML, wikiGalaxyPage()); // SPEC：HTTP 状态码，沿用 desk.mjs deskRoute
    return true;
  }
  let graph;
  try { graph = scanWiki(wikiDir); } catch {
    send(res, 500, JSON_TYPE, JSON.stringify({ error: 'wiki scan failed' })); // SPEC：HTTP 状态码，沿用 desk.mjs deskRoute
    return true;
  }
  const name = wikiDir.split(sep).filter(Boolean).pop() ?? 'wiki';
  send(res, 200, JSON_TYPE, JSON.stringify({ name, ...graph })); // SPEC：HTTP 状态码，沿用 desk.mjs deskRoute
  return true;
}
