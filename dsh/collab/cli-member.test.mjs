// CliMember session persistence: resume a stored ACP sessionId with session/load,
// or open a new session and report lost when the CLI cannot load it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CliMember, cleanEnv } from './cli-member.mjs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('spawn failure retries after the missing directory is created', { timeout: 5000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-retry-'));
  const cwd = join(dir, 'workspace');
  writeFileSync(join(dir, 'gemini'), `#!${process.execPath}
const { createInterface } = require('node:readline');
const send = frame => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') send({ id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  if (request.method === 'session/new') send({ id: request.id, result: { sessionId: 'recovered' } });
  if (request.method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: 'recovered', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ready again' } } } });
    send({ id: request.id, result: { stopReason: 'end_turn' } });
  }
});
`, { mode: 0o755 });
  const m = new CliMember({ cli: 'gemini', cwd, env: { PATH: dir } });
  t.after(() => m.close());
  await assert.rejects(m.ask('first', 'r1'), { code: 'COLLAB_CLI_START' });
  const failedProcess = m.proc;
  mkdirSync(cwd);
  assert.equal(await m.ask('second', 'r1'), 'ready again');
  assert.notEqual(m.proc, failedProcess, 'the next ask starts a fresh process');
  assert.equal(m.sessions.get('r1').sessionId, 'recovered');
});

/** A CliMember whose ACP connection is a fake; canLoad mirrors agentCapabilities.loadSession. */
function fakeMember({ canLoad, loadFails = false, persona = 'P' } = {}) {
  const m = new CliMember({ cli: 'claude', cwd: '/tmp', persona });
  const calls = { load: [], newSession: 0, prompts: [] };
  let n = 0;
  m._start = async () => {
    m.canLoad = canLoad;
    m.ready = Promise.resolve({});
    m.exited = new Promise(() => {});
    m.conn = {
      loadSession: async (r) => { calls.load.push(r.sessionId); if (loadFails) throw new Error('no such session'); return {}; },
      newSession: async () => { calls.newSession += 1; return { sessionId: `new-${++n}` }; },
      prompt: async (r) => { calls.prompts.push(r); m.buffers.set(r.sessionId, 'ok'); return { stopReason: 'end_turn' }; },
    };
    return m.ready;
  };
  return { m, calls };
}

test('resumes a stored sessionId with session/load when the CLI supports it', async () => {
  const { m, calls } = fakeMember({ canLoad: true });
  const seen = [];
  const reply = await m.ask('hi', 'r1', undefined, undefined, { resumeId: 'acp-1', onSession: s => seen.push(s) });
  assert.equal(reply, 'ok');
  assert.deepEqual(calls.load, ['acp-1']);
  assert.equal(calls.newSession, 0);
  assert.deepEqual(seen, [{ sessionId: 'acp-1', resumed: true, lost: false }]);
  assert.equal(calls.prompts[0].sessionId, 'acp-1');
});

test('opens a new session and reports lost when the CLI has no loadSession', async () => {
  const { m, calls } = fakeMember({ canLoad: false });
  const seen = [];
  await m.ask('hi', 'r1', undefined, undefined, { resumeId: 'acp-1', onSession: s => seen.push(s) });
  assert.deepEqual(calls.load, []);
  assert.equal(calls.newSession, 1);
  assert.deepEqual(seen, [{ sessionId: 'new-1', resumed: false, lost: true }]);
});

test('opens a new session and reports lost when session/load fails', async () => {
  const { m, calls } = fakeMember({ canLoad: true, loadFails: true });
  const seen = [];
  await m.ask('hi', 'r1', undefined, undefined, { resumeId: 'acp-1', onSession: s => seen.push(s) });
  assert.deepEqual(calls.load, ['acp-1']);
  assert.deepEqual(seen, [{ sessionId: 'new-1', resumed: false, lost: true }]);
});

test('a first turn with nothing stored is a new session, not lost', async () => {
  const { m } = fakeMember({ canLoad: true });
  const seen = [];
  await m.ask('hi', 'r1', undefined, undefined, { onSession: s => seen.push(s) });
  assert.deepEqual(seen, [{ sessionId: 'new-1', resumed: false, lost: false }]);
});

test('after a CLI crash the saved sessionId is resumed on the next turn', async () => {
  const { m, calls } = fakeMember({ canLoad: true });
  await m.ask('hi', 'r1');
  // What the exit handler does: keep live session ids in saved, drop the live map.
  for (const [room, s] of m.sessions) m.saved.set(room, s.sessionId);
  m.sessions.clear();
  const seen = [];
  await m.ask('again', 'r1', undefined, undefined, { onSession: s => seen.push(s) });
  assert.deepEqual(calls.load, ['new-1']);
  assert.deepEqual(seen, [{ sessionId: 'new-1', resumed: true, lost: false }]);
});

test('persona is prepended on every turn', async () => {
  const { m, calls } = fakeMember({ canLoad: true, persona: 'PERSONA' });
  await m.ask('one', 'r1');
  await m.ask('two', 'r1');
  assert.deepEqual(calls.prompts.map(p => p.prompt[0].text), ['PERSONA\n\none', 'PERSONA\n\ntwo']);
});

test('cleanEnv drops the outer Claude Code session markers but keeps the env-var sign-in', () => {
  const env = cleanEnv({
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_SSE_PORT: '1234',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-x',
    ANTHROPIC_API_KEY: 'key-x',
    PATH: '/bin',
  });
  assert.deepEqual(env, { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-x', ANTHROPIC_API_KEY: 'key-x', PATH: '/bin' });
});

test('text resumed after a tool call starts a new paragraph, so a closing [report] opens its line', async () => {
  const m = new CliMember({ cli: 'claude', cwd: '/tmp', persona: '' });
  m._start = async () => {
    m.ready = Promise.resolve({});
    m.exited = new Promise(() => {});
    m.conn = {
      newSession: async () => ({ sessionId: 's1' }),
      prompt: async () => {
        const c = m._client();
        await c.sessionUpdate({ sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '【接】#3\n\n总结文档：' } } });
        await c.sessionUpdate({ sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Write' } });
        await c.sessionUpdate({ sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '[report]\n' } } });
        await c.sessionUpdate({ sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '56 个测试通过' } } });
        return { stopReason: 'end_turn' };
      },
    };
    return m.ready;
  };
  const reply = await m.ask('hi', 'r1');
  assert.equal(reply, '【接】#3\n\n总结文档：\n\n[report]\n56 个测试通过');
});
