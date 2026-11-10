#!/usr/bin/env node
// Make a new bothouse plugin from plugins/template.
//
//   node plugins/scripts/new-plugin.mjs <package-name> [target-dir]
//
// Copies the template (index.mjs, lib/, cordis.patch.yml, package.json, README.md) and renames the
// package, the patch row and the exported name. target-dir defaults to plugins/<package-name>.
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const template = resolve(here, '../template');
const OLD = 'bothouse-plugin-template';

const [name, target] = process.argv.slice(2);
// 来源：npm 包名规则，与 bridge/core/plugin_spec.go pluginRegistryName 同一条。
if (!name || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)) {
  console.error('usage: node plugins/scripts/new-plugin.mjs <package-name> [target-dir]\n  package-name: an npm name, e.g. bothouse-role-hello or @you/bothouse-hello');
  process.exit(2);
}
const dir = resolve(target || join(here, '..', name.replace(/^@[^/]+\//, '')));
if (existsSync(dir)) {
  console.error(`${dir} already exists`);
  process.exit(1);
}
cpSync(template, dir, { recursive: true, filter: (src) => !src.includes('node_modules') && !src.endsWith('.tgz') });
for (const file of ['package.json', 'cordis.patch.yml', 'index.mjs', 'README.md']) {
  const p = join(dir, file);
  if (existsSync(p)) writeFileSync(p, readFileSync(p, 'utf8').replaceAll(OLD, name));
}
console.log(`created ${dir}\nnext: edit index.mjs and cordis.patch.yml, then \`npm pack\` and install the .tgz from the panel (see docs/plugins/plugin-dev.md).`);
