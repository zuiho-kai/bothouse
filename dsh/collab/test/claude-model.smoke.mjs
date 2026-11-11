// Opt-in: real collab HTTP routes + installed Claude ACP/CLI, with an isolated local provider.
// No real credentials, user channels, or production configuration are used.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { startHost } from '../desk-e2e/host.mjs';
import { Store } from '../store.mjs';
import { Later } from '../later.mjs';

const root = mkdtempSync(join(tmpdir(), 'bothouse-claude-model-'));
const dataDir = join(root, 'data'), workspacePath = join(root, 'workspace'), claudeDir = join(root, 'claude');
for (const dir of [dataDir, workspacePath, claudeDir]) mkdirSync(dir);
// The same environment contract as a configured CLI member, with a fake local API key.
for (const key of Object.keys(process.env)) {
  if (/TOKEN|API_KEY|SECRET|ANTHROPIC|CLAUDE|CONEST|^CC_|^BOARD_|^GATE_|^BOTHOUSE/.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  CLAUDE_CONFIG_DIR: claudeDir, ANTHROPIC_API_KEY: 'isolated-test-key',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  BOTHOUSE_DATA_DIR: root, BOTHOUSE_CONFIG: join(root, 'config.toml'),
  CONEST_WIKI_DIR: join(root, 'wiki'), GATE_PORT: '1',
});
writeFileSync(join(root, 'config.toml'), '');
writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ model: 'claude-sonnet-4-5-20250929' }));
const seen = [];
const provider = createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const body = raw ? JSON.parse(raw) : {};
  if (req.url.includes('count_tokens')) { res.setHeader('content-type', 'application/json'); return res.end('{"input_tokens":10}'); }
  if (!req.url.startsWith('/v1/messages')) { res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  seen.push({ model: body.model, messages: JSON.stringify(body.messages) });
  const message = { id: 'msg_isolated', type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: 'isolated-ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } };
  if (!body.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(message)); }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  send('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'isolated-ok' } });
  send('content_block_stop', { index: 0 });
  send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
  send('message_stop', {}); res.end();
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${provider.address().port}`;
let host, db;
const ticketStore = new Store(':memory:');
try {
  host = await startHost({ dataDir, workspacePath, leadFile: join(root, 'lead.json'), fallbackLead: 'lead', dshMembers: [{ id: 'lead', name: 'Lead' }] });
  db = new DatabaseSync(join(dataDir, 'collab.sqlite3'), { readOnly: true });
  const signer = new Later({ store: ticketStore }, ':memory:', () => {}, { start: false, keyFile: join(dataDir, 'later.key') });
  async function call(method, path, body, ticket) {
    const response = await fetch(host.url + path, { method, headers: { 'content-type': 'application/json', ...(ticket ? { 'x-later-ticket': ticket } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, 200, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  await call('PATCH', '/collab/api/rooms/1/settings', { lead_id: 'lead' });
  const team = await call('POST', '/collab/api/rooms/1/team', { channel: 'isolated', members: [{ name: 'Claude', cli: 'claude', persona: 'Reply with one short word; do not use tools.' }] }, signer.ticket('lead', 1));
  const id = team.members[0].id, room = team.room.id;
  const row = () => ({ ...db.prepare('SELECT * FROM members WHERE id = ?').get(id) });
  await call('PATCH', `/collab/api/members/${id}`, { permissionPreset: 'read-only', nameCustomized: true });
  const before = row();
  assert.equal(before.cli, 'claude');
  assert.equal((await call('GET', '/collab/api/panel/members')).members.find(m => m.id === id).can_edit, true);
  const firstModel = 'claude-sonnet-4-5-20250929', nextModel = 'claude-opus-4-1-20250805';
  await call('PATCH', `/collab/api/panel/members/${id}`, { model: firstModel });
  assert.deepEqual({ ...row(), model: before.model }, before);
  console.log('PASS PATCH model: HTTP 200; every other persisted column unchanged');
  async function turn(marker, model) {
    await call('POST', `/collab/api/rooms/${room}/messages`, { text: `@Claude ${marker}` });
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const job = db.prepare('SELECT * FROM jobs WHERE member_id = ? ORDER BY id DESC LIMIT 1').get(id);
      if (job?.state === 'failed') throw Error(`CLI job failed: ${JSON.stringify(job)}`);
      if (job?.state === 'done' && seen.some(r => r.messages.includes(marker))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const requests = seen.filter(r => r.messages.includes(marker));
    assert.ok(requests.length, `real Claude CLI sent ${marker} to isolated provider`);
    assert.equal(requests.at(-1).model, model);
    const job = db.prepare('SELECT state FROM jobs WHERE member_id = ? ORDER BY id DESC LIMIT 1').get(id);
    assert.equal(job.state, 'done');
    console.log(`PASS actual CLI request ${marker}: model=${model}, job=done`);
  }
  await turn('probe1592-one', firstModel);
  const binding = db.prepare('SELECT session_id FROM bindings WHERE member_id = ? AND room_id = ?').get(id, room).session_id;
  await call('PATCH', `/collab/api/members/${id}`, { model: nextModel });
  assert.deepEqual({ ...row(), model: before.model }, before);
  await turn('probe1592-two', nextModel);
  assert.equal(db.prepare('SELECT session_id FROM bindings WHERE member_id = ? AND room_id = ?').get(id, room).session_id, binding);
  console.log('PASS actual switch: next turn changed model while preserving the ACP session');
  await call('PATCH', `/collab/api/members/${id}`, { persona: 'Updated persona' });
  assert.equal(row().model, nextModel);
  console.log('PASS omitted model: persona-only PATCH retained model and CLI');
  await call('PATCH', `/collab/api/panel/members/${id}`, { model: null });
  await turn('probe1592-clear', firstModel);
  console.log('PASS clearing override: live session restored configured CLI default');
  const invalid = await fetch(host.url + `/collab/api/panel/members/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: { provider: 'p', model: 'm' } }) });
  assert.equal(invalid.status, 400); assert.equal(row().model, null);
  const readOnly = await fetch(host.url + '/collab/api/panel/members/lead', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'sonnet' }) });
  assert.equal(readOnly.status, 403);
  console.log('PASS invalid model: HTTP 400 without mutation; config member: HTTP 403');
} finally {
  db?.close(); ticketStore.close();
  await host?.close();
  await new Promise(resolve => provider.close(resolve));
}
