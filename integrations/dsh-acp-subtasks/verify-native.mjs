// Validate against an installed DSH without modifying that installation or
// invoking a model. Temporary copies are intentionally left for inspection.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, symlink, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { apply } from './apply.mjs';
import { attachSubagentUpdates } from './lifecycle.mjs';

// Copy the complete installed entrypoint, including its optional lifecycle
// helper, so an already patched installation remains importable in isolation.
export async function copyInstallation(source) {
  const pkg = await mkdtemp(join(tmpdir(), 'bothouse-native-subtasks-'));
  await mkdir(join(pkg, 'lib'));
  await copyFile(join(source, 'package.json'), join(pkg, 'package.json'));
  await copyFile(join(source, 'lib/index.js'), join(pkg, 'lib/index.js'));
  const entrypoint = await readFile(join(pkg, 'lib/index.js'), 'utf8');
  if (entrypoint.includes('// bothouse: native subagent lifecycle v1')) {
    await copyFile(join(source, 'lib/bothouse-subtasks.mjs'), join(pkg, 'lib/bothouse-subtasks.mjs'));
  }
  let dependencies = join(source, 'node_modules');
  try { await access(dependencies); } catch { dependencies = dirname(dirname(source)); }
  await symlink(dependencies, join(pkg, 'node_modules'), 'dir');
  return pkg;
}

async function verifyNative(source) {
  const pkg = await copyInstallation(source);
  await apply(pkg);
  assert.equal(await apply(pkg), false);
  const acp = await import(pathToFileURL(join(pkg, 'lib/index.js')));
  assert.equal(typeof acp.apply, 'function');
  const require = createRequire(join(source, 'package.json'));
  const subagent = require.resolve('@deepseek-ai/dsh-subagent');
  const { carrierKeyOf, scopeTarget } = await import(pathToFileURL(createRequire(subagent).resolve('@deepseek-ai/dsh-scope')));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')));
  const sdk = require.resolve('@agentclientprotocol/sdk');
  const { zSessionNotification } = await import(pathToFileURL(join(dirname(sdk), 'schema/zod.gen.js')));
  const ctx = new Context();
  const parent = { session: { id: 'parent' } }, child = {}, updates = [];
  const record = { drainUpdates: async () => {} };
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  attachSubagentUpdates(ctx, {
    carrierKeyOf, agents: { get: () => child },
    ownedRecord: (agent) => agent === parent ? record : undefined,
    notify: async (raw) => {
      const parsed = zSessionNotification.parse(raw);
      assert.deepEqual(parsed, raw); // SDK must preserve the extension.
      updates.push(parsed);
      if (parsed.update._meta['bothouse/subagent'].status === 'completed') finish();
    },
  });
  const carrier = scopeTarget({}, parent);
  ctx.emit(carrier, 'subagent/start', { id: 'child', runId: 'run', local: true });
  ctx.emit(carrier, 'subagent/end', { id: 'child', runId: 'run', local: true, stopReason: 'completed', lastAssistantMessage: 'PRIVATE' });
  let timer;
  try {
    await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('native lifecycle was not delivered')), 5000); })]);
  } finally { clearTimeout(timer); }
  assert.deepEqual(updates.map((u) => u.update._meta['bothouse/subagent'].status), ['running', 'completed']);
  assert.ok(!JSON.stringify(updates).includes('PRIVATE'));
  console.log('PASS: patched bundle import, native Cordis scope, ACP SDK validation, ordered lifecycle and private-output exclusion');
  console.log('Inspection copy:', pkg);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node verify-native.mjs <dsh-acp package dir>');
  await verifyNative(resolve(process.argv[2]));
}
