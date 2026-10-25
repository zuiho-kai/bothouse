// CliMember session persistence: resume a stored ACP sessionId with session/load,
// or open a new session and report lost when the CLI cannot load it. No CLI is spawned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CliMember } from './cli-member.mjs';

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
