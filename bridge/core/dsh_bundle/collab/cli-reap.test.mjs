import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { DshMembers } from './dsh-member.mjs';
import { CliMember } from './cli-member.mjs';
import { Roster } from './roster.mjs';

function setup(t) {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'first');
  store.ensureRoom(2, 'second');
  const hub = new Hub(store, { warn() {} });
  const created = [];
  const context = { turn: () => ({ block: '', commit() {} }), resetRoom() {} };
  const members = new DshMembers(hub, {
    workspacePath: process.cwd(), gateContext: context, memoryIndex: context,
    createCliMember(options) {
      const agent = { options, closes: 0, async ask() { return 'done'; }, close() { this.closes++; } };
      created.push(agent);
      return agent;
    },
  }, [{ id: 'cc', name: 'CC', cli: 'gemini' }]);
  // Same callback the plugin installs for a newly claimed workspace.
  store.onSessionsReset(id => members.resetRoom(id));
  t.after(async () => { await members.close(); store.close(); });
  async function run(roomId, memberId = 'cc') {
    const trigger = store.append(roomId, { authorKind: 'user', author: 'owner', name: 'Owner', text: 'work' }).message;
    const job = store.addJob(memberId, roomId, trigger.id);
    await members.runCli(job, members.config.get(memberId), store.room(roomId));
    assert.equal(store.job(job.id).state, 'done');
  }
  return { store, hub, members, created, run };
}

test('CLI reap: reset closes only the target room, including its obsolete directories', async t => {
  const { store, members, created, run } = setup(t);
  await run(1);
  await run(2);
  store.setWorkspacePath(1, '/changed', process.cwd());
  store.resetSessions(1);
  assert.equal(created[0].closes, 1, 'reset must close the room process');
  assert.equal(created[1].closes, 0, 'another room keeps its process');
  await run(1);
  assert.equal(created.length, 3, 'reset starts a new process');
  assert.equal(created[2].options.cwd, '/changed');
  assert.equal(members.cliAgents.size, 2);
  assert.deepEqual(created.map(x => x.options.env.CC_SESSION_KEY), ['dsh:cc:1', 'dsh:cc:2', 'dsh:cc:1']);
});

test('CLI reap: release closes immediately, preserves bindings, and reuse stays bounded', async t => {
  const { store, members, created, run } = setup(t);
  await run(1);
  for (const parent of [1, 2, 1]) {
    const workspace = store.createWorkspace(parent);
    await run(workspace.id);
    const binding = store.binding('cc', workspace.id);
    assert.equal(store.releaseWorkspace(workspace.id), true);
    assert.equal(created.at(-1).closes, 1, 'a free workspace must have no live CLI');
    assert.deepEqual(store.binding('cc', workspace.id), binding, 'release retains resumable history');
    assert.equal(members.cliAgents.size, 1, 'only the chat process remains');
  }
  assert.equal(created[0].closes, 0);
});

test('CLI reap: roster scope edit closes removed channel and child workspaces, retains DM and other channel', async t => {
  const { store, hub, members, created, run } = setup(t);
  const roster = new Roster(hub, members);
  const member = await roster.create({ name: 'Scoped', cli: 'gemini' });
  const workspace = store.createWorkspace(1);
  const dm = store.openDm(member.id, member.name);
  for (const id of [1, workspace.id, 2, dm.id]) await run(id, member.id);
  await roster.update(member.id, { name: member.name, cli: 'gemini', rooms: [2] });
  assert.deepEqual(created.map(x => x.closes), [1, 1, 0, 0]);
  await roster.update(member.id, { name: 'Renamed', cli: 'gemini', rooms: [2] });
  assert.deepEqual(created.map(x => x.closes), [1, 1, 0, 0], 'rename does not stop surviving processes');
  roster.remove(member.id);
  assert.deepEqual(created.map(x => x.closes), [1, 1, 1, 1], 'member removal closes every surviving process');
});

test('CLI reap: workspace release terminates a real child PID through CliMember.close', { timeout: 5000 }, async t => {
  const { store, members, run } = setup(t);
  let agent;
  members.rt.createCliMember = options => {
    agent = new CliMember(options);
    agent.proc = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'ignore', 'ignore'] });
    agent.ask = async () => 'done';
    return agent;
  };
  const workspace = store.createWorkspace(1);
  await run(workspace.id);
  const proc = agent.proc;
  t.after(() => proc.kill());
  const exited = once(proc, 'exit');
  assert.doesNotThrow(() => process.kill(proc.pid, 0));
  store.releaseWorkspace(workspace.id);
  await exited;
  assert.throws(() => process.kill(proc.pid, 0), { code: 'ESRCH' });
});

// A shebang fake is not executable by name on Windows; the PID test above works on both OSes.
test('CLI reap: real ACP handshake then reset, release and member removal terminate their PIDs', { timeout: 5000, skip: process.platform === 'win32' }, async t => {
  const { store, members, run } = setup(t);
  const dir = mkdtempSync(join(tmpdir(), 'cli-reap-acp-'));
  writeFileSync(join(dir, 'gemini'), `#!${process.execPath}
const { createInterface } = require('node:readline');
const send = frame => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + String.fromCharCode(10));
createInterface({ input: process.stdin }).on('line', line => {
  const r = JSON.parse(line);
  if (r.method === 'initialize') send({ id: r.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  if (r.method === 'session/new') send({ id: r.id, result: { sessionId: 'test-session' } });
  if (r.method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: 'test-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } } } });
    send({ id: r.id, result: { stopReason: 'end_turn' } });
  }
});
`, { mode: 0o755 });
  const agents = [];
  members.rt.createCliMember = options => {
    const agent = new CliMember({ ...options, env: { ...options.env, PATH: dir } });
    agents.push(agent);
    return agent;
  };
  t.after(() => { for (const agent of agents) agent.close(); });
  const workspace = store.createWorkspace(1);
  for (const action of ['reset', 'release', 'remove']) {
    await run(workspace.id);
    const proc = agents.at(-1).proc;
    const exited = once(proc, 'exit');
    assert.doesNotThrow(() => process.kill(proc.pid, 0));
    if (action === 'reset') store.resetSessions(workspace.id);
    if (action === 'release') {
      const binding = store.binding('cc', workspace.id);
      store.releaseWorkspace(workspace.id);
      assert.deepEqual(store.binding('cc', workspace.id), binding);
      store.createWorkspace(1);
    }
    if (action === 'remove') members.dropMember('cc');
    await exited;
    assert.throws(() => process.kill(proc.pid, 0), { code: 'ESRCH' }, action);
  }
});
