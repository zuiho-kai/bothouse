// bothouse fork：按 bothouse-assets.json 从上游固定提交下载 assets/webm 并校验 sha256。
// 已存在且校验对的文件跳过。用法：node scripts/bothouse-fetch-assets.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(readFileSync(join(root, 'bothouse-assets.json'), 'utf8'));
const out = join(root, 'assets', 'webm');
mkdirSync(out, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
let fetched = 0;
for (const [name, want] of Object.entries(m.files)) {
  const file = join(out, name);
  if (existsSync(file) && sha(readFileSync(file)) === want) continue;
  const url = `https://raw.githubusercontent.com/${m.upstream}/${m.commit}/${m.dir}/${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== want) throw new Error(`${name}: sha256 mismatch`);
  writeFileSync(file, buf);
  fetched++;
}
console.log(`assets/webm: ${Object.keys(m.files).length} files ok (${fetched} downloaded)`);
