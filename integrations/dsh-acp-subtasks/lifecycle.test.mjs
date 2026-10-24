import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachSubagentUpdates } from './lifecycle.mjs';
import { apply } from './apply.mjs';
import { copyInstallation } from './verify-native.mjs';
import { pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture() {
  const listeners = new Map(), updates = [];
  const parent = { session: { id: 'parent' } }, child = {}, record = { drainUpdates: async () => {} };
  const ctx = { on: (name, fn) => listeners.set(name, fn), logger: { warn: (error) => assert.fail(error) } };
  attachSubagentUpdates(ctx, { carrierKeyOf: (carrier) => carrier.parent, ownedRecord: (p) => p === parent ? record : undefined, notify: async (update) => updates.push(update), agents: { get: () => child } });
  return { parent, child, updates, listeners, emit: (name, data, p = parent) => listeners.get(name).call({ parent: p }, data) };
}

test('native start/end carry identity and outcomes, excluding private payloads', async () => {
  for (const [reason, expected] of [['completed','completed'],['aborted','stopped'],['error','failed'],['max-tokens','failed'],['refusal','failed']]) {
    const f = fixture(), info = { id: 'child', runId: 'run', local: true, prompt: 'PRIVATE' };
    await f.emit('subagent/start', info);
    await f.emit('subagent/end', { ...info, stopReason: reason, lastAssistantMessage: 'PRIVATE' });
    assert.equal(f.updates[0].update.sessionUpdate, 'tool_call');
    assert.equal(f.updates[1].update._meta['bothouse/subagent'].status, expected);
    assert.equal(f.updates[1].sessionId, 'parent');
    assert.ok(!JSON.stringify(f.updates).includes('PRIVATE'));
  }
});

test('background lifecycle outlives prompt, rejects impostors and keeps epochs separate', async () => {
  const f = fixture(), info = { id: 'child', runId: 'run-1', local: true };
  await f.emit('subagent/start', info, { session: { id: 'parent' } });
  assert.equal(f.updates.length, 0);
  await f.emit('subagent/start', info);
  await f.emit('subagent/start', info);
  await f.emit('subagent/end', { ...info, stopReason: 'completed' }, { session: { id: 'parent' } });
  assert.equal(f.updates.length, 1);
  await f.emit('subagent/end', { ...info, stopReason: 'completed' });
  await f.emit('subagent/start', { ...info, runId: 'run-2', local: false });
  assert.equal(f.updates[2].update._meta['bothouse/subagent'].runId, 'run-2');
});

test('idle is waiting, not successful completion; status only follows the exact child', async () => {
  const f = fixture(), info = { id: 'child', runId: 'run', local: true };
  await f.emit('subagent/start', info);
  await f.emit('agent/status', { agent: {}, status: 'idle' });
  await f.emit('agent/status', { agent: f.child, status: 'idle' });
  // agent/status queues without blocking the native event emitter.
  await f.emit('subagent/end', { ...info, stopReason: 'aborted' });
  assert.deepEqual(f.updates.map((u) => u.update._meta['bothouse/subagent'].status), ['running','waiting','stopped']);
});

test('child label, preset and tool name become task, name and step; arguments never cross', async () => {
  const f = fixture(), info = { id: 'child', runId: 'run', local: true };
  const event = (id, type, data) => f.listeners.get('session/event')({ header: { id } }, { type, data });
  // The descriptor is appended while the child is prepared, before start.
  event('child', 'subagent/descriptor', { version: 3, mode: 'continuable', provider: 'local', label: '审查登录修复', persona: 'PRIVATE' });
  event('child', 'agent-preset/selected', { agentPreset: 'reviewer' });
  await f.emit('subagent/start', info);
  event('child', 'tool/call', { name: 'shell', arguments: '{"cmd":"PRIVATE"}' });
  event('other', 'tool/call', { name: 'PRIVATE' });
  event('child', 'assistant/message', { message: 'PRIVATE' });
  await f.emit('subagent/end', { ...info, stopReason: 'completed', lastAssistantMessage: 'PRIVATE' });
  const metas = f.updates.map((u) => u.update._meta['bothouse/subagent']);
  assert.deepEqual(metas[0], { id: 'child', runId: 'run', status: 'running', name: 'reviewer', task: '审查登录修复' });
  assert.equal(metas[1].step, 'shell');
  assert.equal(metas.at(-1).status, 'completed');
  assert.ok(!JSON.stringify(f.updates).includes('PRIVATE'));
});

test('installer validates version/seam before modifying, backs up and is idempotent', async () => {
  const pkg = await mkdtemp(join(tmpdir(), 'bothouse-subtasks-'));
  await mkdir(join(pkg, 'lib'));
  const file = join(pkg, 'lib/index.js');
  for (const name of ['dsh-subagent', 'dsh-scope']) {
    const dep = join(pkg, 'node_modules/@deepseek-ai', name);
    await mkdir(dep, { recursive: true });
    await writeFile(join(dep, 'package.json'), JSON.stringify({ name: '@deepseek-ai/' + name, main: 'index.js' }));
    await writeFile(join(dep, 'index.js'), '');
  }
  const source = 'const ownedRecord = (agent) => {};\nconst notify = async (notification) => {};\n\tctx.on("session/event", (session, event) => {});\n';
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-acp', version: 'future' }));
  await writeFile(file, source);
  await assert.rejects(apply(pkg), /Unsupported/);
  assert.equal(await readFile(file, 'utf8'), source);
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-acp', version: '0.2.1-rc.2' }));
  assert.equal(await apply(pkg), true);
  assert.equal(await readFile(file + '.before-bothouse-subtasks', 'utf8'), source);
  assert.equal(await apply(pkg), false);
  assert.match(await readFile(file, 'utf8'), /attachSubagentUpdates\(ctx/);
  // npm can replace index.js while leaving our recovery copy behind.
  await writeFile(file, source);
  assert.equal(await apply(pkg), true);
  assert.equal(await readFile(file + '.before-bothouse-subtasks', 'utf8'), source);
  assert.equal(await apply(pkg), false);
  // A different upstream source must not overwrite an older recovery copy.
  const upgraded = source + '// different upstream build\n';
  await writeFile(file, upgraded);
  await assert.rejects(apply(pkg), /backup.*differs/i);
  assert.equal(await readFile(file, 'utf8'), upgraded);
  assert.equal(await readFile(file + '.before-bothouse-subtasks', 'utf8'), source);
});

test('verification copy of an installed package retains its imported lifecycle helper', async () => {
  const source = await mkdtemp(join(tmpdir(), 'bothouse-installed-subtasks-'));
  await mkdir(join(source, 'lib'));
  await mkdir(join(source, 'node_modules'));
  await writeFile(join(source, 'package.json'), JSON.stringify({ type: 'module' }));
  const entrypoint = '// bothouse: native subagent lifecycle v1\nexport { installed } from "./bothouse-subtasks.mjs";\n';
  await writeFile(join(source, 'lib/index.js'), entrypoint);
  await writeFile(join(source, 'lib/bothouse-subtasks.mjs'), 'export const installed = true;\n');
  const copied = await copyInstallation(source);
  assert.equal((await import(pathToFileURL(join(copied, 'lib/index.js')))).installed, true);
  assert.equal(await readFile(join(source, 'lib/index.js'), 'utf8'), entrypoint);
});
