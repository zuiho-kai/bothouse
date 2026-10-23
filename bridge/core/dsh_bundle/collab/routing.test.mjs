import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { CloudWebGateway } from './cloudweb.mjs';

const quiet = { warn() {}, info() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));
class Socket extends EventEmitter {
  sent = [];
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.emit('close'); }
  messages() { return this.sent.filter(frame => frame.type === 'message'); }
}
function fixture(t, leadMember) {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, quiet, { leadMember });
  const gateway = new CloudWebGateway(hub, { token: 'test', logger: quiet });
  const sockets = {};
  for (const [id, name] of [['gge', 'G哥'], ['gjiang', '大豆包']]) {
    const ws = new Socket();
    gateway.accept(ws, new URL(`http://test/cloud-web/ws?bot=${id}&name=${encodeURIComponent(name)}`));
    ws.emit('message', JSON.stringify({ type: 'register' }), false);
    sockets[id] = ws;
  }
  t.after(() => { gateway.closeAll(); store.close(); });
  return { store, hub, sockets };
}

test('routing: ordinary user message activates only the configured lead', async t => {
  const { hub, sockets } = fixture(t, 'gge');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '你好' });
  await tick();
  assert.equal(sockets.gge.messages().at(-1).mentioned, true);
  assert.equal(sockets.gjiang.messages().at(-1).mentioned, false);
});

test('routing: explicit mention overrides lead and retries do not dispatch again', async t => {
  const { hub, sockets } = fixture(t, 'gge');
  const message = { authorKind: 'user', author: 'owner', name: '我', text: '@大豆包 你好', clientKey: 'retry' };
  hub.post(1, message);
  hub.post(1, message);
  await tick();
  assert.equal(sockets.gge.messages().at(-1).mentioned, false);
  assert.equal(sockets.gjiang.messages().at(-1).mentioned, true);
  assert.equal(sockets.gjiang.messages().length, 1);
});

test('routing: a refusal mentioning a bare name never delegates, explicit @ does', async t => {
  const { hub, sockets } = fixture(t, 'gge');
  hub.post(1, { authorKind: 'role', author: 'gge', name: 'G哥', text: '我无法替你去问大豆包：没有可用发送通道。' });
  await tick();
  assert.equal(sockets.gjiang.messages().at(-1).mentioned, false);
  hub.post(1, { authorKind: 'role', author: 'gge', name: 'G哥', text: '@大豆包 请算 7 的 3 次方' });
  await tick();
  assert.equal(sockets.gjiang.messages().at(-1).mentioned, true);
});

for (const lead of [undefined, 'missing', 'gge']) {
  test(`routing: missing/offline lead produces one persisted notice (${lead})`, async t => {
    const { hub, sockets, store } = fixture(t, lead);
    if (lead === 'gge') sockets.gge.close();
    const message = { authorKind: 'user', author: 'owner', name: '我', text: '有人吗', clientKey: 'notice-retry' };
    hub.post(1, message);
    hub.post(1, message);
    await tick();
    const notices = store.page(1).filter(m => m.author_kind === 'system');
    assert.equal(notices.length, 1);
    assert.match(notices[0].text, /主 bot/);
    assert.equal(sockets.gjiang.messages().some(m => m.mentioned), false);
  });
}

test('routing: exact aliases, unknown recipients, code fences and email boundaries', async t => {
  const { hub, sockets, store } = fixture(t, 'gge');
  for (const [text, expected] of [
    ['@gjiang-other 请处理', [false, false]],
    ['<@999> 请处理', [false, false]],
    ['请@大豆包 看一下', [false, true]],
    ['发邮件给 me@gjiang.example', [true, false]],
    ['```@大豆包``` 看这个例子', [true, false]],
    ['@G哥 @大豆包 一起看', [true, true]],
  ]) {
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text });
    await tick();
    assert.deepEqual([sockets.gge, sockets.gjiang].map(ws => ws.messages().at(-1).mentioned), expected, text);
  }
  assert.equal(store.page(1).filter(m => m.author_kind === 'system').length, 2);
});

test('routing: offline explicit recipients give feedback without falling back to lead', async t => {
  const { hub, sockets, store } = fixture(t, 'gge');
  sockets.gjiang.close();
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@大豆包 你好' });
  await tick();
  assert.equal(sockets.gge.messages().at(-1).mentioned, false);
  assert.match(store.page(1).find(m => m.author_kind === 'system').text, /gjiang.*离线/);
});

for (const mode of ['throw', 'callback', 'closing']) {
  test(`routing: targeted socket failure is visible once (${mode})`, async t => {
    const { hub, sockets, store } = fixture(t, 'gge');
    if (mode === 'closing') sockets.gge.readyState = 3;
    else sockets.gge.send = (_text, callback) => {
      if (mode === 'throw') throw Error('socket failed');
      queueMicrotask(() => callback(Error('write failed')));
    };
    const input = { authorKind: 'user', author: 'owner', name: '我', text: 'hello', clientKey: 'failed-once' };
    hub.post(1, input);
    await tick();
    hub.post(1, input);
    await tick();
    const notices = store.page(1).filter(m => m.author_kind === 'system');
    assert.equal(notices.length, 1);
    assert.match(notices[0].text, /未能投递给 gge/);
    assert.equal(hub.members.get('gge').online, false);
    assert.equal(sockets.gjiang.messages().some(m => m.mentioned), false);
  });
}

test('routing: errored lead has feedback but explicit retry can recover it', async t => {
  const { hub, sockets, store } = fixture(t, 'gge');
  hub.setError('gge', 'previous provider failure');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: 'hello' });
  await tick();
  assert.equal(sockets.gge.messages().at(-1).mentioned, false);
  assert.match(store.page(1).find(m => m.author_kind === 'system').text, /主 bot gge 当前不可用/);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@G哥 retry' });
  await tick();
  assert.equal(sockets.gge.messages().at(-1).mentioned, true);
});
