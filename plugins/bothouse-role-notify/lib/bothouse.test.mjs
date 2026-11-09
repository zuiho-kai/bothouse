import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enabledRoles, readSSE, statusFilter, followRoles } from './bothouse.mjs';

async function* chunks(...parts) {
  for (const p of parts) yield new TextEncoder().encode(p);
}

test('readSSE splits frames across chunks and skips non-JSON', async () => {
  const out = [];
  for await (const f of readSSE(chunks('event: snapshot\ndata: {"roles":[]}\n', '\nevent: idle\r\ndata: {"role_key":"bridge:a"}\r\n\r\n: ping\n\ndata: nope\n\n'))) out.push(f);
  assert.deepEqual(out, [
    { event: 'snapshot', data: { roles: [] } },
    { event: 'idle', data: { role_key: 'bridge:a' } },
  ]);
});

test('enabledRoles keeps only roles that enable this plugin', () => {
  const got = enabledRoles({
    'bridge:a': [{ plugin_id: 'p', enabled: true }],
    'bridge:b': [{ plugin_id: 'p', enabled: false }],
    'dsh:c': [{ plugin_id: 'other', enabled: true }],
  }, 'p');
  assert.deepEqual([...got], ['bridge:a']);
});

test('statusFilter: empty means all, unknown names dropped', () => {
  assert.equal(statusFilter([]).size, 6);
  assert.deepEqual([...statusFilter(['error', 'bogus'])], ['error']);
});

test('followRoles delivers only bound roles', async () => {
  const sse = 'event: snapshot\ndata: {"roles":[{"role_key":"bridge:a"},{"role_key":"bridge:b"}]}\n\n'
    + 'event: error\ndata: {"type":"error","role_key":"bridge:b"}\n\n'
    + 'event: celebrate\ndata: {"type":"celebrate","role_key":"bridge:a","role":{"display_name":"A"}}\n\n';
  const fetchImpl = async (url) => url.endsWith('/role-bindings')
    ? new Response(JSON.stringify({ ok: true, data: { bindings: { 'bridge:a': [{ plugin_id: 'p', enabled: true }] } } }))
    : new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); } }));
  const seen = [];
  let snap;
  const done = new Promise((resolve) => {
    const r = followRoles({ bridge: 'http://x', pluginId: 'p', fetchImpl, logger: { warn() {} },
      onSnapshot: (roles) => { snap = roles.map((x) => x.role_key); },
      onEvent: (ev) => { seen.push(ev.type); r.stop(); resolve(); } });
  });
  await done;
  assert.deepEqual(snap, ['bridge:a']);
  assert.deepEqual(seen, ['celebrate']);
});
