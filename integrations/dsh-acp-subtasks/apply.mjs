import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Explicit installation only. Never edits a running DSH installation by itself.
export async function apply(target) {
  let pkg = resolve(target);
  try { await access(resolve(pkg, 'node_modules/@deepseek-ai/dsh-acp/package.json')); pkg = resolve(pkg, 'node_modules/@deepseek-ai/dsh-acp'); } catch {}
  const manifest = JSON.parse(await readFile(resolve(pkg, 'package.json'), 'utf8'));
  if (manifest.name !== '@deepseek-ai/dsh-acp' || !['0.1.5-rc.3', '0.2.1-rc.2'].includes(manifest.version)) {
    throw new Error('Unsupported dsh-acp version; port and test before applying');
  }
  const file = resolve(pkg, 'lib/index.js');
  const original = await readFile(file, 'utf8');
  const marker = '// bothouse: native subagent lifecycle v1';
  const hook = '\tctx.on("session/event", (session, event) => {';
  if (original.includes(marker)) return false;
  if (original.split(hook).length !== 2 || !original.includes('const ownedRecord = (agent) =>') || !original.includes('const notify = async (notification) =>')) {
    throw new Error('ACP ownership/notification seam changed; no files modified');
  }
  const helper = resolve(dirname(fileURLToPath(import.meta.url)), 'lifecycle.mjs');
  // Under pnpm, ACP cannot import another package's private dependency by
  // name. Resolve scope through the native subagent package which owns it.
  const subagent = createRequire(resolve(pkg, 'package.json')).resolve('@deepseek-ai/dsh-subagent');
  const scope = createRequire(subagent).resolve('@deepseek-ai/dsh-scope');
  const updated = 'import { carrierKeyOf as bothouseCarrierKeyOf } from ' + JSON.stringify(pathToFileURL(scope).href) + ';\n' +
    'import { attachSubagentUpdates } from "./bothouse-subtasks.mjs";\n' +
    original.replace(hook, marker + '\n\tattachSubagentUpdates(ctx, { carrierKeyOf: bothouseCarrierKeyOf, ownedRecord, notify, agents: ctx.agents });\n' + hook);
  // Reuse an identical recovery copy after npm/pnpm replaces index.js.
  // Never overwrite a different upstream version's rollback target.
  const backup = file + '.before-bothouse-subtasks';
  try {
    const saved = await readFile(backup, 'utf8');
    if (saved !== original) {
      throw new Error('Existing bothouse subagent backup differs; review or move it manually before reinstalling');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(backup, original, { flag: 'wx' });
  }
  await copyFile(helper, resolve(pkg, 'lib/bothouse-subtasks.mjs'));
  await writeFile(file, updated);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node apply.mjs <dsh run dir or dsh-acp package dir>');
  console.log(await apply(process.argv[2]) ? 'Subagent lifecycle installed; takes effect on the next ACP process start.' : 'Already installed.');
}
