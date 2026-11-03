// Wiki 星河：扫描、链接解析、路由。全部用临时 wiki 目录，不碰真实 wiki。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanWiki, splitFrontmatter, wikiGalaxyRoute } from './wiki-galaxy.mjs';
import { resolveConfig } from './plugin.mjs';

function wiki() {
  const root = mkdtempSync(join(tmpdir(), 'galaxy-'));
  const put = (path, text) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); };
  put('MEMORY.md', '# 目录\n- [ai](ai/README.md) — 本地 AI\n');
  put('ai/README.md', '# ai\n- [[pet]]\n');
  put('ai/pets/pet.md', '---\nname: pet\ndescription: 桌宠\n---\n# 桌宠\n第一行\n见 [[infra-vps|VPS]] 和 [[nope]]\n');
  put('infra/vps.md', '---\nname: infra-vps\n---\n# VPS\n回到 [[ai]]\n');
  put('.ingest-work/copy.md', '# 不该出现\n');
  return root;
}
function fakeRes() {
  return { status: 0, headers: {}, body: '', writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b ?? ''; } };
}

test('frontmatter: name 和 description 读出来，正文去掉头', () => {
  const { meta, body } = splitFrontmatter('---\nname: a\ndescription: "b c"\n---\n# T\n');
  assert.deepEqual(meta, { name: 'a', description: 'b c' });
  assert.equal(body, '# T\n');
});

test('scan: 每页一颗星，按顶层目录分团，隐藏目录不扫', () => {
  const g = scanWiki(wiki());
  assert.deepEqual(g.nodes.map(n => n.id).sort(), ['MEMORY.md', 'ai/README.md', 'ai/pets/pet.md', 'infra/vps.md']);
  assert.deepEqual(g.groups, { '': 1, ai: 2, infra: 1 });
  const pet = g.nodes.find(n => n.id === 'ai/pets/pet.md');
  assert.equal(pet.title, '桌宠');
  assert.equal(pet.description, '桌宠');
  assert.match(pet.excerpt, /第一行/);
});

test('links: [[name]]、[[name|别名]]、目录名指 README、相对 .md 链接；找不到的不连，重复的只算一条', () => {
  const g = scanWiki(wiki());
  const pairs = g.links.map(l => [l.source, l.target].sort().join(' ')).sort();
  assert.deepEqual(pairs, [
    'MEMORY.md ai/README.md',
    'ai/README.md ai/pets/pet.md',
    'ai/README.md infra/vps.md',
    'ai/pets/pet.md infra/vps.md',
  ]);
});

test('scan: 不跟符号链接出 wiki 目录', () => {
  const root = wiki();
  const outside = mkdtempSync(join(tmpdir(), 'galaxy-out-'));
  writeFileSync(join(outside, 'secret.md'), '# 外面\n');
  symlinkSync(outside, join(root, 'linked'));
  assert.ok(!scanWiki(root).nodes.some(n => n.id.startsWith('linked/')));
});

test('route: 页面与接口；别的路径不处理', () => {
  const root = wiki();
  const page = fakeRes();
  assert.equal(wikiGalaxyRoute({ method: 'GET' }, page, new URL('http://x/collab/wiki-galaxy'), { wikiDir: root }), true);
  assert.match(page.body, /WIKI 星河/);
  const api = fakeRes();
  wikiGalaxyRoute({ method: 'GET' }, api, new URL('http://x/collab/api/wiki-galaxy'), { wikiDir: root });
  assert.equal(JSON.parse(api.body).nodes.length, 4);
  assert.equal(wikiGalaxyRoute({ method: 'GET' }, fakeRes(), new URL('http://x/collab/desk'), { wikiDir: root }), undefined);
  assert.equal(wikiGalaxyRoute({ method: 'POST' }, fakeRes(), new URL('http://x/collab/api/wiki-galaxy'), { wikiDir: root }), undefined);
});

test('config: wikiDir 默认 ~/wiki，可用配置或 CONEST_WIKI_DIR 改，必须是绝对路径', () => {
  const base = { dataDir: '/tmp/d', workspacePath: '/tmp/w' };
  assert.equal(resolveConfig(base, { HOME: '/home/u' }).wikiDir, '/home/u/wiki');
  assert.equal(resolveConfig(base, { HOME: '/home/u', CONEST_WIKI_DIR: '/srv/wiki' }).wikiDir, '/srv/wiki');
  assert.equal(resolveConfig({ ...base, wikiDir: '/a/b' }, { HOME: '/home/u', CONEST_WIKI_DIR: '/srv/wiki' }).wikiDir, '/a/b');
  assert.throws(() => resolveConfig({ ...base, wikiDir: 'rel' }, { HOME: '/home/u' }), /wikiDir must be an absolute path/);
});
