import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { request } from 'node:http';
import { startBotPort } from './bot-port.mjs';
import { resolveConfig } from './plugin.mjs';

const raw = (port, head) => new Promise((resolve, reject) => {
  const s = connect(port, '127.0.0.1', () => s.write(head));
  let out = ''; s.on('data', d => { out += d; s.end(); }); s.on('end', () => resolve(out.split('\r\n')[0])); s.on('error', reject);
});

test('bot port: cloud-web upgrade and history reach the plugin handlers, everything else 404', async () => {
  const seen = [];
  const l = await startBotPort({
    port: 0, path: '/cloud-web/ws',
    upgrade: (req, socket) => { seen.push(req.url); socket.end('HTTP/1.1 101 Switching Protocols\r\n\r\n'); },
    history: (req, res) => { seen.push(req.url); res.end('[]'); },
  });
  try {
    const up = (path) => raw(l.port, `GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    assert.equal(await up('/cloud-web/ws?bot=cjiang'), 'HTTP/1.1 101 Switching Protocols');
    assert.equal(await up('/collab/api/state'), 'HTTP/1.1 404 Not Found');
    const get = (path) => new Promise((resolve) => request({ host: '127.0.0.1', port: l.port, path }, res => { res.resume(); resolve(res.statusCode); }).end());
    assert.equal(await get('/api/rooms/1/messages?limit=5'), 200);
    assert.equal(await get('/collab/'), 404);
    assert.deepEqual(seen, ['/cloud-web/ws?bot=cjiang', '/api/rooms/1/messages?limit=5']);
  } finally { await l.close(); }
});

test('config: botPort from config or env, rejects non-ports', () => {
  const base = { dataDir: '/d', workspacePath: '/w' };
  assert.equal(resolveConfig(base, { HOME: '/h' }).botPort, undefined);
  assert.equal(resolveConfig({ ...base, botPort: 49180 }, { HOME: '/h' }).botPort, 49180);
  assert.equal(resolveConfig(base, { HOME: '/h', CONEST_COLLAB_BOT_PORT: '49180' }).botPort, 49180);
  assert.throws(() => resolveConfig({ ...base, botPort: 'abc' }, { HOME: '/h' }), /botPort/);
  assert.throws(() => resolveConfig({ ...base, botPort: 70000 }, { HOME: '/h' }), /botPort/);
});
