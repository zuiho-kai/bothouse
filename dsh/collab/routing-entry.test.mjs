import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
const runtimeUrl = new URL('./test/routing-entry-runtime.mjs', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['@deepseek-ai/dsh-llm', '@agentclientprotocol/sdk'].includes(specifier)) {
      return { url: runtimeUrl, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
after(() => hooks.deregister());
const { apply } = await import('./plugin.mjs');

const quiet = { info() {}, warn() {} };
const ownerHeader = 'x-routing-test-owner';
const postPath = '/collab/api/rooms/1/messages';
const historyPath = '/api/rooms/1/messages';
const gatewayPath = '/cloud-web/ws';

// A real TCP server executes the handlers registered by plugin.apply. The fake
// host supplies only registration/lifecycle and owner identity, never routing.
async function host(t, { dataDir = mkdtempSync(join(tmpdir(), 'bothouse-routing-')), leadMember = 'gge' } = {}) {
  const routes = [];
  const upgrades = [];
  const disposers = [];
  const sockets = new Set();
  const clients = new Set();
  const warnings = [];
  const ownerToken = randomUUID();
  const botToken = randomUUID();
  const botTokenEnv = 'BOTHOUSE_ROUTING_ENTRY_TEST_BOT_TOKEN';
  let closed = false;
  const forbidden = () => { throw Error('entry test must not call a model or start a CLI'); };
  const ctx = {
    logger: { ...quiet, warn(...args) { warnings.push(args); } },
    connection: { requestRejection: req => req.headers[ownerHeader] === ownerToken ? undefined : 'unauthorized' },
    webServer: {
      register(route) { routes.push(route); return () => routes.splice(routes.indexOf(route), 1); },
      registerUpgrade(route) { upgrades.push(route); return () => upgrades.splice(upgrades.indexOf(route), 1); },
    },
    effect(setup) { disposers.push(setup()); },
    on() {},
    agents: { get: forbidden, create: forbidden, resume: forbidden },
    agentDefaultModel: { currentSelection: forbidden },
    agentPresets: { resolve: forbidden, acquireScope: forbidden, mount: forbidden },
    permissionPresets: { set: forbidden },
    sessionTitle: { rename: forbidden },
    workspaceRegistry: { create: forbidden },
    llm: { listProviders: forbidden, listModels: forbidden },
  };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://test.invalid').pathname;
    const route = routes.find(r => path === r.path || (r.kind === 'prefix' && path.startsWith(`${r.path}/`)));
    if (!route) { res.writeHead(404); res.end(); return; }
    Promise.resolve().then(() => route.handler(req, res)).catch(error => {
      warnings.push([error]);
      res.writeHead(500);
      res.end('test host handler failed');
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url, 'http://test.invalid').pathname;
    const route = upgrades.find(r => r.path === path);
    if (route) route.handler(req, socket, head);
    else socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  async function close() {
    if (closed) return;
    closed = true;
    for (const ws of clients) ws.terminate();
    for (const dispose of disposers.reverse()) await dispose?.();
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.deepEqual(warnings, [], 'host, gateway and runtime must not hide asynchronous failures');
  }
  t.after(close);
  const previousToken = process.env[botTokenEnv];
  process.env[botTokenEnv] = botToken;
  try {
    await apply(ctx, { dataDir, workspacePath: dataDir, leadMember, botTokenEnv, dshMembers: [] });
  } finally {
    if (previousToken === undefined) delete process.env[botTokenEnv];
    else process.env[botTokenEnv] = previousToken;
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { auth = 'owner', method = 'GET', body } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (auth === 'owner') headers[ownerHeader] = ownerToken;
    if (auth === 'bot') headers.authorization = `Bearer ${botToken}`;
    const res = await fetch(base + path, { method, headers, signal: AbortSignal.timeout(5_000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() };
  }
  async function post(text, clientKey = randomUUID()) {
    const res = await request(postPath, { method: 'POST', body: { text, client_key: clientKey } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.message;
  }
  async function history() {
    const res = await request(historyPath);
    assert.equal(res.status, 200);
    return res.body.messages;
  }
  function socket(query, token = botToken) {
    const url = new URL(gatewayPath, base.replace('http:', 'ws:'));
    url.search = new URLSearchParams({ ...query, token }).toString();
    const ws = new WebSocket(url, { handshakeTimeout: 5_000 });
    clients.add(ws);
    // Error listeners keep intentional failed upgrade checks from becoming
    // unhandled events; successful flows still reject via once/waitFrame.
    ws.on('error', () => {});
    return ws;
  }
  async function connect(id, name = id) {
    const ws = socket({ bot: id, name });
    const frames = [];
    ws.on('message', data => frames.push(JSON.parse(String(data))));
    await once(ws, 'open');
    const ack = waitFrame(ws, frame => frame.type === 'register_ack');
    ws.send(JSON.stringify({ type: 'register', platform: 'cloud_web', client: 'cc-connect', project: id, transport: 'ws' }));
    assert.equal((await ack).ok, true);
    return {
      ws, frames,
      messages: () => frames.filter(f => f.type === 'message'),
      async barrier() {
        const pong = waitFrame(ws, f => f.type === 'pong');
        ws.send(JSON.stringify({ type: 'ping' }));
        await pong;
      },
      async reply(content) {
        ws.send(JSON.stringify({ type: 'reply', reply_ctx: 'room-1', content, agent: true }));
        await this.barrier();
      },
      async disconnect() {
        const done = once(ws, 'close');
        ws.close();
        await done;
        await until(async () => {
          const state = await request('/collab/api/state');
          return state.body.members.some(m => m.id === id && !m.online);
        });
      },
    };
  }
  return { dataDir, request, post, history, socket, connect, close };
}

function waitFrame(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(Error('timed out waiting for gateway frame')), 5_000);
    const onMessage = data => {
      const frame = JSON.parse(String(data));
      if (predicate(frame)) finish(undefined, frame);
    };
    const onError = error => finish(error);
    const onClose = () => finish(Error('gateway closed before expected frame'));
    function finish(error, frame) {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
      ws.off('close', onClose);
      if (error) reject(error); else resolve(frame);
    }
    ws.on('message', onMessage);
    ws.on('error', onError);
    ws.on('close', onClose);
  });
}

async function until(predicate) {
  const signal = AbortSignal.timeout(5_000);
  while (!await predicate()) {
    signal.throwIfAborted();
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function team(h) {
  return Promise.all([h.connect('gge', '队长'), h.connect('ju', '橘'), h.connect('whale', '鲸鱼娘')]);
}

async function routed(clients, messageId) {
  await Promise.all(clients.map(c => c.barrier()));
  return clients.map(c => c.messages().filter(f => f.msg_id === `hub-${messageId}`));
}

test('plugin entry: owner auth protects POST; bot auth protects WS upgrade and history', async t => {
  const h = await host(t);
  for (const auth of ['none', 'bot']) {
    const denied = await h.request(postPath, { auth, method: 'POST', body: { text: '@橘 unauthorized', client_key: 'denied' } });
    assert.equal(denied.status, 401);
  }
  const badWs = h.socket({ bot: 'imposter' }, 'wrong-test-token');
  const [response] = await new Promise((resolve, reject) => {
    badWs.once('unexpected-response', (_req, res) => { res.resume(); badWs.terminate(); resolve([res]); });
    badWs.once('open', () => reject(Error('unauthorized WebSocket upgraded')));
    badWs.once('error', error => { if (!/closed before/.test(error.message)) reject(error); });
  });
  assert.equal(response.statusCode, 401);
  assert.equal((await h.request(historyPath, { auth: 'none' })).status, 401);
  assert.equal((await h.request(historyPath, { auth: 'bot' })).status, 200);
  assert.deepEqual(await h.history(), [], 'rejected POSTs must not persist or dispatch');
  const ju = await h.connect('ju', '橘');
  const accepted = await h.post('@橘 authorized');
  const [[frame]] = await routed([ju], accepted.id);
  assert.equal(frame.mentioned, true);
  assert.equal(frame.user_id, 'owner');
});

test('plugin entry: configured gge receives ordinary owner input once; peers receive context only', async t => {
  const h = await host(t);
  const clients = await team(h);
  const message = await h.post('请给出下一步建议', 'ordinary-once');
  const frames = await routed(clients, message.id);
  assert.deepEqual(frames.map(rows => rows.map(f => f.mentioned)), [[true], [false], [false]]);
  const repeated = await h.post('请给出下一步建议', 'ordinary-once');
  assert.equal(repeated.id, message.id);
  assert.deepEqual(await routed(clients, message.id), frames, 'HTTP retry must not redispatch to any socket');
});

test('plugin entry: explicit owner @ selects only the named bot, overriding gge', async t => {
  const h = await host(t);
  const clients = await team(h);
  const message = await h.post('@橘 请检查这段输出');
  const frames = await routed(clients, message.id);
  assert.deepEqual(frames.map(rows => rows.map(f => f.mentioned)), [[false], [true], [false]]);
  assert.equal(frames[1][0].content, '请检查这段输出');
});

test('plugin entry: persisted explicit @ client_key survives host restart without another dispatch', async t => {
  const h = await host(t);
  const peer = await h.connect('ju', '橘');
  const first = await h.post('@橘 请检查这段输出', 'explicit-once');
  assert.deepEqual((await routed([peer], first.id)).map(rows => rows.map(f => f.mentioned)), [[true]]);
  const rows = await h.history();
  await h.close();
  const restarted = await host(t, { dataDir: h.dataDir });
  assert.deepEqual(await restarted.history(), rows);
  const reconnectedPeer = await restarted.connect('ju', '橘');
  const retried = await restarted.post('@橘 请检查这段输出', 'explicit-once');
  assert.equal(retried.id, first.id);
  await reconnectedPeer.barrier();
  assert.deepEqual(reconnectedPeer.messages(), []);
  assert.deepEqual(await restarted.history(), rows);
});

test('plugin entry: an owner bare name stays ordinary input for the configured lead', async t => {
  const h = await host(t);
  const clients = await team(h);
  const message = await h.post('橘，请看看这个');
  assert.deepEqual((await routed(clients, message.id)).map(rows => rows.map(f => f.mentioned)), [[true], [false], [false]]);
});

test('plugin entry: a bot bare-name reply is retained as context without handing work off', async t => {
  const h = await host(t);
  const clients = await team(h);
  await clients[0].reply('橘，请看看这个');
  const reply = (await h.history()).find(m => m.author === 'gge');
  assert.ok(reply, 'reply must enter through the registered gateway and persist');
  assert.equal(reply.from_turn, 1, 'the wire reply must be recorded as an agent turn');
  const frames = await routed(clients, reply.id);
  assert.deepEqual(frames.map(rows => rows.map(f => f.mentioned)), [[], [false], [false]]);
  assert.equal(frames[1][0].from_bot, true);
});

test('plugin entry: a real bot reply with explicit @ activates only its handoff target', async t => {
  const h = await host(t);
  const clients = await team(h);
  await clients[0].reply('@橘 请接手核对');
  const reply = (await h.history()).find(m => m.author === 'gge');
  assert.ok(reply);
  const frames = await routed(clients, reply.id);
  assert.deepEqual(frames.map(rows => rows.map(f => f.mentioned)), [[], [true], [false]]);
  assert.equal(frames[1][0].from_bot, true);
  assert.match(frames[1][0].content, /请接手核对/);
});

for (const unavailable of ['offline', 'missing']) {
  test(`plugin entry: ${unavailable} lead gives durable feedback; client_key retries never redispatch`, async t => {
    const h = await host(t);
    const peer = await h.connect('ju', '橘');
    if (unavailable === 'offline') {
      const lead = await h.connect('gge', '队长');
      await lead.disconnect();
    }
    const first = await h.post('需要队长处理', 'unavailable-once');
    const before = await routed([peer], first.id);
    assert.deepEqual(before.map(rows => rows.map(f => f.mentioned)), [[false]], 'no fallback activation');
    const repeated = await h.post('需要队长处理', 'unavailable-once');
    assert.equal(repeated.id, first.id);
    assert.deepEqual(await routed([peer], first.id), before, 'duplicate request must not even re-send context');
    const rows = await h.history();
    assert.equal(rows.filter(m => m.author_kind === 'user').length, 1);
    const feedback = rows.filter(m => m.author_kind === 'system');
    assert.equal(feedback.length, 1, 'unavailable lead must generate exactly one persisted system notice');
    assert.match(feedback[0].text, /gge|队长|主.*(?:AI|角色|成员)/i);
    assert.match(feedback[0].text, /离线|不在线|不存在|缺失|未.*(?:配置|连接|找到)|不可用|offline|missing|unavailable|not (?:found|connected|online)/i);
    await h.close();
    const restarted = await host(t, { dataDir: h.dataDir });
    assert.deepEqual(await restarted.history(), rows, 'feedback must survive plugin teardown and SQLite reopen');
    const reconnectedPeer = await restarted.connect('ju', '橘');
    const retried = await restarted.post('需要队长处理', 'unavailable-once');
    assert.equal(retried.id, first.id);
    await reconnectedPeer.barrier();
    assert.deepEqual(reconnectedPeer.messages(), [], 'persisted client key dedupes across host restart');
    assert.deepEqual(await restarted.history(), rows, 'retry after restart must not create another notice');
  });
}
