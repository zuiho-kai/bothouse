import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { forDisplay, forMember, mentions, nameCalled } from './mentions.mjs';
import { CloudWebGateway, CAPABILITIES, progressCard, PROGRESS_PREFIX } from './cloudweb.mjs';
import { DshMembers, finalText, describeReason } from './dsh-member.mjs';
import { resolveConfig, roomActionRoute } from './plugin.mjs';
import { Roster } from './roster.mjs';
import { promptText } from './dsh-member.mjs';

const quiet = { warn() {}, info() {} };
const tick = () => new Promise(r => setImmediate(r));

function makeHub() {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, quiet);
  hub.setMember({ id: 'owner', name: '我', kind: 'human', online: true });
  return hub;
}

class FakeWs extends EventEmitter {
  constructor() { super(); this.sent = []; this.closed = undefined; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.closed = { code, reason }; this.emit('close'); }
  frame(obj) { this.emit('message', Buffer.from(JSON.stringify(obj)), false); }
  of(type) { return this.sent.filter(f => f.type === type); }
}

const fixtureTokens = () => new Map(['ju', 'whale', 'a', 'b', 'c', 'cw', 'cx', 'imposter'].map(id => ['test-' + id, id]));

function connect(gateway, query, headers) {
  if (headers === undefined) {
    const id = new URLSearchParams(query).get('bot');
    const token = [...gateway.tokens].find(([, member]) => member === id)?.[0];
    headers = token ? { authorization: 'Bearer ' + token } : {};
  }
  const ws = new FakeWs();
  gateway.accept(ws, new URL(`http://x/cloud-web/ws?${query}`), headers);
  ws.frame({ type: 'register', platform: 'cloud_web', client: 'cc-connect', project: 'p', transport: 'ws' });
  return ws;
}

test('store: client keys dedupe, pages are oldest-first, jobs are created and finished once', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  const a = s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'hi', clientKey: 'k1' });
  const again = s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'hi', clientKey: 'k1' });
  assert.equal(a.created, true);
  assert.equal(again.created, false);
  assert.equal(again.message.id, a.message.id);
  for (const t of ['b', 'c', 'd']) s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: t });
  assert.deepEqual(s.page(1, undefined, 2).map(m => m.text), ['c', 'd']);
  assert.deepEqual(s.page(1, 3, 10).map(m => m.text), ['hi', 'b']);
  assert.deepEqual(s.since(1, 2, 10).map(m => m.text), ['c', 'd']);
  assert.throws(() => s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '  ' }), /empty/);
  assert.throws(() => s.append(9, { authorKind: 'user', author: 'owner', name: '我', text: 'x' }), /room 9/);

  const job = s.addJob('ds', 1, a.message.id);
  assert.equal(s.addJob('ds', 1, a.message.id), undefined);
  assert.equal(s.markSent(job.id, 'sess', 5), true);
  assert.equal(s.markSent(job.id, 'sess', 5), false);
  assert.equal(s.finishJob(job.id, 'done', 1), true);
  assert.equal(s.finishJob(job.id, 'failed'), false);
  assert.deepEqual(s.openJobs(), []);
});

test('mentions: own mention removed, others rewritten, fences ignored, bare name calls', () => {
  const members = [{ id: 'ju', name: '橘', mentionId: '111' }, { id: 'ds', name: 'DeepSeek' }];
  const ju = members[0];
  assert.deepEqual([...mentions('@橘 看下 @DeepSeek', members)].sort(), ['ds', 'ju']);
  assert.deepEqual([...mentions('```\n@橘\n```', members)], []);
  assert.equal(forMember('@橘 看下这个', ju, members), '看下这个');
  assert.equal(forMember('@橘 和 @DeepSeek 一起看', ju, members), '@橘(你) 和 @DeepSeek 一起看');
  assert.equal(forMember('@DeepSeek 叫 <@111>', members[1], members), '@DeepSeek(你) 叫 <@111>');
  assert.equal(forMember('@DeepSeek 你好', members[1], members), '你好');
  assert.equal(forDisplay('<@111> 你好', members), '@橘 你好');
  assert.equal(nameCalled('行了橘，你来', '橘'), true);
  assert.equal(nameCalled('我觉得橘子好吃', '橘'), false);
});

test('cloud-web: register ack, routing, prefixes, no self-echo, reconnect replaces', async () => {
  const hub = makeHub();
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘&mention_id=111');
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');
  assert.deepEqual(ju.of('register_ack')[0], { type: 'register_ack', ok: true, capabilities: CAPABILITIES, server: { name: 'conest-dsh-collab' } });

  const bad = connect(gw, 'bot=ds');
  assert.equal(bad.of('register_ack')[0].ok, false);
  assert.equal(bad.closed.code, 4002);

  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 看看日志' });
  await tick();
  const toJu = ju.of('message').at(-1);
  assert.equal(toJu.content, '看看日志');
  assert.equal(toJu.mentioned, true);
  assert.equal(toJu.chat_id, 'room-1');
  assert.equal(toJu.msg_id.startsWith('hub-'), true);
  assert.equal(whale.of('message').at(-1).content, '<@111> 看看日志');
  assert.equal(whale.of('message').at(-1).mentioned, false);

  ju.frame({ type: 'reply', reply_ctx: 'room-1', content: '看完了 @鲸鱼娘 你接着\n\n*claude · 1k tok*', agent: true });
  await tick(); await tick();
  const stored = hub.store.page(1, undefined, 1)[0];
  assert.equal(stored.author, 'ju');
  assert.equal(stored.from_turn, 1);
  const toWhale = whale.of('message').at(-1);
  assert.equal(toWhale.from_bot, true);
  assert.equal(toWhale.mentioned, true);
  assert.equal(toWhale.content, '【橘】看完了 你接着');
  assert.equal(toWhale.user_mention_id, '111');
  assert.equal(ju.of('message').length, 1, 'author never receives its own reply');

  const before = whale.of('message').length;
  ju.frame({ type: 'reply', reply_ctx: 'room-1', content: '✅ 已完成' });
  await tick(); await tick();
  assert.equal(whale.of('message').length, before, 'status notices are not forwarded');

  ju.frame({ type: 'preview_start', ref_id: 'r1', content: 'x' });
  assert.deepEqual(ju.of('preview_ack').at(-1), { type: 'preview_ack', ref_id: 'r1', preview_handle: '' });
  ju.frame({ type: 'preview_start', ref_id: 'r2', reply_ctx: 'room-1', content: PROGRESS_PREFIX + JSON.stringify({ state: 'running', steps: 2, agent: 'Claude' }) });
  const handle = ju.of('preview_ack').at(-1).preview_handle;
  assert.match(handle, /^\d+$/);
  assert.equal(whale.of('message').length, before, 'previews are not forwarded');
  whale.frame({ type: 'delete_message', preview_handle: handle });
  assert.ok(hub.store.message(Number(handle)), 'another bot cannot delete it');
  ju.frame({ type: 'delete_message', preview_handle: handle });
  assert.equal(hub.store.message(Number(handle)), undefined);

  ju.frame({ type: 'typing_start', reply_ctx: 'room-1' });
  assert.deepEqual([...hub.thinking.get(1)], ['ju']);
  const ju2 = connect(gw, 'bot=ju&name=橘');
  assert.equal(ju.closed.code, 4003);
  assert.equal(hub.thinking.get(1).has('ju'), false, 'reconnect clears stale typing');
  assert.equal(hub.members.get('ju').online, true, 'replaced socket close does not mark offline');
  ju2.close(1000);
  assert.equal(hub.members.get('ju').online, false);
});

test('cloud-web: token check reads headers only, never the query string', () => {
  const gw = new CloudWebGateway(makeHub(), { token: 'secret', logger: quiet });
  assert.equal(gw.authorized({ headers: { authorization: 'Bearer secret' } }), true);
  assert.equal(gw.authorized({ headers: { 'x-cloud-web-token': 'secret' } }), true);
  // A token in the URL ends up in access logs, proxy logs and browser history, so it no
  // longer authenticates anything: the credential must travel in a header.
  assert.equal(gw.authorized({ headers: {} }), false);
  assert.equal(gw.authorized({ headers: { authorization: 'Bearer nope' } }), false);
  assert.equal(new CloudWebGateway(makeHub(), { token: '', logger: quiet }).authorized({ headers: {} }), false);
});

test('progress card payload becomes a titled card', () => {
  const c = progressCard(PROGRESS_PREFIX + JSON.stringify({ state: 'completed', steps: 3, elapsed_sec: 75, agent: 'Codex', items: [{ kind: 'tool_use', tool: 'Bash', text: 'go test' }] }));
  assert.equal(JSON.parse(c.card).title, 'Codex · 已完成');
  assert.match(c.text, /第 3 步 · 1分15秒\n🔧 Bash — go test/);
  assert.equal(progressCard('plain'), undefined);
});


/**
 * Minimal DSH runtime. Agents keep a pending inbox and a Session event log;
 * `turn()` plays one real-shaped turn: turn/start, the consumed input as
 * user/message (same id), assistant messages, turn/end — and feeds each event
 * to the driver like the root session/event listener does.
 */
function fakeDsh({ emitDiscarded = false } = {}) {
  const sessions = new Map();
  const made = [];
  let ids = 0;
  let members;
  const agentFor = (id) => {
    const session = { id, events: [], get seq() { return this.events.length; }, snapshotEvents(from = 0) { return this.events.slice(from); }, requestHeader() { return undefined; } };
    const pending = [];
    const agent = {
      session, prompts: [], turns: 0, cancellations: [], ctx: { on() {} },
      cancel(cause, options) {
        this.cancellations.push({ cause, options });
        emit(this, 'turn/end', { turn: this.turns, reason: { kind: 'aborted', reason: cause } });
      },
      async whenIdle() {},
      followup(m) { this.prompts.push(m); pending.push(m); },
      inbox: { get nextTurn() { return pending; }, remove(id) { const i = pending.findIndex(m => m.id === id); if (i < 0) return false; pending.splice(i, 1); if (emitDiscarded) members?.onDiscarded(session.id, id); return true; } },
    };
    sessions.set(id, agent);
    return agent;
  };
  const ctx = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4' }) },
    agents: {
      get: id => sessions.get(id),
      created: [], resumes: 0, active: 0, maxActive: 0,
      async create(options) { const agent = agentFor(options.sessionId); made.push(options.sessionId); this.created.push(options); await options.setup?.({ on() {} }); return { agent }; },
      async resume({ resumeSessionId }) {
        this.resumes++; this.active++; this.maxActive = Math.max(this.maxActive, this.active);
        await tick();
        this.active--;
        return { agent: sessions.get(resumeSessionId) ?? agentFor(resumeSessionId) };
      },
    },
    agentPresets: { released: 0, async resolve() { return { id: 'default' }; }, async acquireScope() { const p = this; return { async [Symbol.asyncDispose]() { p.released++; } }; }, async mount() {} },
    permissionPresets: { set() {} },
    sessionTitle: { renamed: [], rename(s, t) { this.renamed.push(t); } },
    workspaceRegistry: { async create(path) { return { path, async attachSession() {} }; } },
  };
  const emit = (agent, type, data) => {
    const event = { type, data, seq: agent.session.events.length + 1 };
    agent.session.events.push(event);
    members?.onSessionEvent(agent.session, event);
    return event;
  };
  /** Play one turn; `input` (default: the oldest pending prompt) is consumed by it. */
  const turn = (agent, texts, reason = { kind: 'completed' }, input = agent.inbox.nextTurn[0]) => {
    const n = ++agent.turns;
    emit(agent, 'turn/start', { turn: n });
    if (input !== undefined) {
      agent.inbox.nextTurn.splice(agent.inbox.nextTurn.findIndex(m => m.id === input.id), 1);
      members?.onClaimed(agent.session.id, input.id, n);
      emit(agent, 'user/message', input);
    }
    for (const text of texts) emit(agent, 'assistant/message', { message: { content: [{ type: 'text', text }] } });
    if (reason !== null) emit(agent, 'turn/end', { turn: n, reason });
  };
  const createUserMessage = m => ({ ...m, role: 'user', id: `in-${++ids}` });
  const attach = (hub, list, options) => {
    members = new DshMembers(hub, { ctx, createUserMessage, workspacePath: '/w', logger: quiet }, list, options);
    return members;
  };
  return { ctx, sessions, made, emit, turn, attach };
}

const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

const ask = (hub, text = '@DeepSeek work', room = 1) => hub.post(room, { authorKind: 'user', author: 'owner', name: '我', text });

test('stop: cancels active and queued channel jobs, preserves Web UI inbox and other rooms', async () => {
  const hub = makeHub(); hub.store.ensureRoom(2, 'other');
  const dsh = fakeDsh(); const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  ask(hub); await settle();
  const agent = dsh.sessions.get(dsh.made[0]);
  dsh.turn(agent, ['partial @DeepSeek'], null);
  agent.followup({ id: 'web-ui', content: [] });
  ask(hub); ask(hub, '@DeepSeek other', 2); await settle();
  const stopping = members.stopRoom(1);
  assert.equal(members.stopRoom(1), stopping);
  assert.throws(() => members.continueRoom(1), /still stopping/);
  const result = await stopping; await settle();
  assert.equal(result.cancelled_jobs, 2); assert.deepEqual(result.unconfirmed, []);
  assert.deepEqual(agent.cancellations, [{ cause: { kind: 'user' }, options: { keepInbox: true } }]);
  assert.deepEqual(agent.inbox.nextTurn.map(m => m.id), ['web-ui']);
  assert.equal(agent.prompts.length, 2, 'pending channel job was never admitted');
  assert.equal(hub.thinking.get(1).size, 0); assert.equal(hub.thinking.get(2).has('ds'), true);
  // A stop keeps the text the turn had already produced, flagged with the reason.
  const stopped = hub.store.page(1, undefined, 50).find(m => m.text.includes('partial'));
  assert.equal(stopped.text, 'partial @DeepSeek\n\n（这一轮没有正常结束：aborted：user）');
  await members.close();
});

test('stop: withdrawing queued input receives discarded, never cancels unrelated Web UI turn', async () => {
  const hub = makeHub(); const dsh = fakeDsh({ emitDiscarded: true });
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  ask(hub); await settle(); const agent = dsh.sessions.get(dsh.made[0]);
  dsh.emit(agent, 'turn/start', { turn: 99 });
  dsh.emit(agent, 'user/message', { id: 'web-active' });
  agent.followup({ id: 'web-pending' });
  let discarded = 0;
  const realDiscard = members.onDiscarded.bind(members);
  members.onDiscarded = (...args) => { discarded++; realDiscard(...args); };
  await members.stopRoom(1); await settle();
  assert.equal(discarded, 1); assert.equal(agent.cancellations.length, 0);
  assert.deepEqual(agent.inbox.nextTurn.map(m => m.id), ['web-pending']);
  assert.equal(members.watching.size, 0); assert.equal(hub.store.openJobs().length, 0);
  // The channel line shows the member's name, not its id.
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '已停止：DeepSeek。', 'the notice names the confirmed member');
  await members.close();
});

test('stop: publishes only the stopped turn, never the next turn in the same session', async () => {
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  ask(hub); await settle(); const agent = dsh.sessions.get(dsh.made[0]);
  const input = agent.inbox.nextTurn[0];
  agent.turns = 1;
  dsh.emit(agent, 'turn/start', { turn: 1 });
  dsh.emit(agent, 'user/message', { id: input.id });
  dsh.emit(agent, 'assistant/message', { message: { content: [{ type: 'text', text: '第一段' }] } });
  // Stop while that turn is running; cancel() ends turn 1, then a Web UI turn starts at once.
  const stopping = members.stopRoom(1);
  agent.turns = 2;
  dsh.emit(agent, 'turn/start', { turn: 2 });
  dsh.emit(agent, 'user/message', { id: 'web-turn' });
  dsh.emit(agent, 'assistant/message', { message: { content: [{ type: 'text', text: 'Web UI 那一轮' }] } });
  await stopping; await settle();
  const mine = hub.store.page(1, undefined, 50).filter(m => m.author === 'ds').map(m => m.text);
  assert.deepEqual(mine, ['第一段\n\n（这一轮没有正常结束：aborted：user）'], 'the next turn stayed out of the channel');
});

test('stop: an idle room says so instead of staying silent', async () => {
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const result = await members.stopRoom(1); await settle();
  assert.deepEqual(result.stopped_members, [], 'no job ran, so no member stopped');
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '没有在跑的任务。');
  assert.equal(hub.store.control(1).stopped, 1, 'the room is still paused for later work');
  await members.close();
});

test('stop: claimed input before user/message logging is still cancelled', async () => {
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  ask(hub); await settle(); const agent = dsh.sessions.get(dsh.made[0]);
  dsh.emit(agent, 'turn/start', { turn: ++agent.turns });
  const input = agent.inbox.nextTurn.shift();
  members.onClaimed(agent.session.id, input.id, agent.turns);
  await members.stopRoom(1);
  assert.equal(agent.cancellations.length, 1);
  await members.close();
});

test('stop: inbox.remove without a discarded event still releases the waiter', async () => {
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  ask(hub); await settle();
  const agent = dsh.sessions.get(dsh.made[0]);
  await members.stopRoom(1); await settle();
  assert.equal(agent.inbox.nextTurn.length, 0);
  assert.equal(members.watching.size, 0);
  assert.equal(hub.thinking.get(1).size, 0);
  await members.close();
});

test('stop: durable room fence survives reopen and prevents crash-gap job recovery', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-stop-')), 'store.sqlite');
  const store = new Store(path); store.ensureRoom(1, 'general');
  const hub = makeHubFrom(store);
  const trigger = ask(hub).message;
  store.addJob('ds', 1, trigger.id);
  hub.stopRoom(1); store.close();
  const reopened = new Store(path); const h2 = makeHubFrom(reopened);
  assert.equal(reopened.control(1).stopped, 1);
  const dsh = fakeDsh(); const members = dsh.attach(h2, [{ id: 'ds', name: 'DeepSeek' }]);
  members.recover(); await settle();
  assert.equal(reopened.openJobs().length, 0); assert.equal(dsh.made.length, 0);
  assert.equal(dsh.ctx.agents.resumes, 0);
  members.continueRoom(1); ask(h2); await settle(); assert.equal(dsh.made.length, 1);
  await members.close(); reopened.close();
});

test('continue: cloud bot relay cap resumes delivery exactly once', async () => {
  const hub = makeHub(); hub.maxRelay = 0;
  const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const a = connect(gw, 'bot=a&name=Alpha'); const b = connect(gw, 'bot=b&name=Beta');
  a.frame({ type: 'reply', reply_ctx: 'room-1', content: '@Beta next', agent: true });
  await settle(); assert.equal(b.of('message').length, 0);
  assert.equal(hub.continueRoom(1).resumed, 1); await settle();
  assert.equal(b.of('message').length, 1); assert.equal(b.of('message')[0].mentioned, true);
  hub.continueRoom(1); await settle(); assert.equal(b.of('message').length, 1);
});

test('stop: shutdown waits for bounded cancellation before SQLite closes', async () => {
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }], { stopTimeoutMs: 20 });
  ask(hub); await settle(); const agent = dsh.sessions.get(dsh.made[0]);
  dsh.turn(agent, [], null); agent.cancel = () => {}; agent.whenIdle = () => new Promise(() => {});
  const stopping = members.stopRoom(1);
  await members.close(); hub.store.close();
  assert.deepEqual((await stopping).unconfirmed, ['ds']);
});

test('stop: cancellation timeout clears thinking within budget and fences late output', async () => {
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }], { stopTimeoutMs: 25 });
  ask(hub); await settle(); const agent = dsh.sessions.get(dsh.made[0]);
  dsh.turn(agent, [], null);
  agent.cancel = () => {}; agent.whenIdle = () => new Promise(() => {});
  const start = Date.now(); const result = await members.stopRoom(1);
  assert.ok(Date.now() - start < 1000); assert.deepEqual(result.unconfirmed, ['ds']);
  assert.equal(hub.thinking.get(1).size, 0);
  dsh.emit(agent, 'assistant/message', { message: { content: [{ type: 'text', text: 'late @DeepSeek' }] } });
  dsh.emit(agent, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
  await settle();
  assert.equal(hub.store.page(1, undefined, 50).some(m => m.text === 'late @DeepSeek'), false);
  assert.equal(hub.store.openJobs().length, 0);
  await members.close();
});

test('stop: unloaded agent is not resumed and an in-flight create cannot admit cancelled work', async () => {
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  ask(hub); await settle();
  dsh.sessions.delete(dsh.made[0]);
  // Nothing was running, so there is nothing left unconfirmed either.
  assert.deepEqual((await members.stopRoom(1)).unconfirmed, []);
  assert.equal(dsh.ctx.agents.resumes, 0);
  await members.close();
  const h2 = makeHub(); const d2 = fakeDsh(); const m2 = d2.attach(h2, [{ id: 'ds', name: 'DeepSeek' }]);
  let release;
  const gate = new Promise(r => { release = r; });
  const create = d2.ctx.agents.create.bind(d2.ctx.agents);
  d2.ctx.agents.create = async o => { const a = await create(o); await gate; return a; };
  ask(h2); await settle(); await m2.stopRoom(1); release(); await settle();
  assert.equal(d2.sessions.get(d2.made[0]).prompts.length, 0);
  await m2.close();
});

test('continue: relay cap resumes one delivery, without duplicate history or repeat budget resets', async () => {
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }], { maxRelay: 0 });
  hub.setMember({ id: 'bot', name: 'Bot', kind: 'bot' });
  hub.post(1, { authorKind: 'role', author: 'bot', name: 'Bot', text: '@DeepSeek resume me' });
  await settle(); assert.equal(dsh.made.length, 0);
  const history = hub.store.page(1, undefined, 50);
  assert.equal(members.continueRoom(1).resumed, 1); await settle();
  assert.equal(dsh.sessions.get(dsh.made[0]).prompts.length, 1);
  const control = hub.store.control(1);
  hub.post(1, { authorKind: 'system', author: 'system', name: 'system', text: 'notice' });
  assert.equal(members.continueRoom(1).resumed, 0);
  assert.equal(hub.store.control(1).relay_after, control.relay_after);
  assert.deepEqual(hub.store.page(1, undefined, 50).slice(0, history.length), history);
  await members.close();
});

test('cloud-web: the fence drops stale context, not everything while stopped', async () => {
  const hub = makeHub(); const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const bot = connect(gw, 'bot=b&name=Bot');
  ask(hub, '@Bot first'); await settle();
  const before = bot.of('message').at(-1).reply_ctx;
  hub.stopRoom(1); gw.stopRoom(1);
  await settle();
  // Output still echoing the pre-stop context stays fenced.
  bot.frame({ type: 'reply', reply_ctx: before, agent: true, content: 'stale reply' });
  bot.frame({ type: 'typing_start', reply_ctx: before });
  await settle();
  assert.equal(hub.store.page(1, undefined, 50).some(m => m.text === 'stale reply'), false);
  assert.equal(hub.thinking.get(1)?.size ?? 0, 0);
  // A message carrying the room's current context is not output of the stopped turn: it lands
  // even though the room is still stopped, so a stop cannot silently eat what comes next.
  const current = gw.replyContext(1, 'b');
  assert.notEqual(current, before, 'the stop moved the room to a new epoch');
  bot.frame({ type: 'reply', reply_ctx: current, content: '主动发的提醒' });
  await settle();
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '主动发的提醒');
});

test('cloud-web: a stop does not swallow what the bot posts on its own', async () => {
  const hub = makeHub(); const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const bot = connect(gw, 'bot=b&name=Bot');
  ask(hub, '@Bot first'); await settle();
  const before = bot.of('message').at(-1).reply_ctx;
  // A turn is running when the user stops the room.
  bot.frame({ type: 'typing_start', reply_ctx: before });
  hub.stopRoom(1); gw.stopRoom(1);
  await settle();
  // The stopped turn's late output is still fenced (the bridge marks turn output agent:true).
  bot.frame({ type: 'reply', reply_ctx: before, agent: true, content: '停之前那轮的迟到输出' });
  await settle();
  assert.equal(hub.store.page(1, undefined, 50).some(m => m.text === '停之前那轮的迟到输出'), false);
  // A timer or proactive notice is not turn output and carries no epoch: it must land, or a
  // stop silently eats it. (Riding the stopped turn's old reply_ctx would look like its output.)
  bot.frame({ type: 'reply', session_key: 'p:room-1', content: '定时任务：该喝水了' });
  await settle();
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '定时任务：该喝水了');
  // Landing in history is not permission to keep relaying: the room is still stopped.
  assert.equal(hub.store.control(1).stopped, 1);
});

test('cloud-web: stop fences old replies, typing and previews through continue', async () => {
  const hub = makeHub(); const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const bot = connect(gw, 'bot=b&name=Bot');
  bot.frame({ type: 'preview_start', ref_id: 'old', reply_ctx: 'room-1', content: 'old preview' });
  const handle = bot.of('preview_ack').at(-1).preview_handle;
  bot.frame({ type: 'typing_start', reply_ctx: 'room-1' });
  hub.stopRoom(1); gw.stopRoom(1);
  for (const continuing of [false, true]) {
    if (continuing) hub.continueRoom(1);
    bot.frame({ type: 'reply', reply_ctx: 'room-1', agent: true, content: 'stale reply' });
    bot.frame({ type: 'typing_start', reply_ctx: 'room-1' });
    bot.frame({ type: 'preview_start', ref_id: 'late', reply_ctx: 'room-1', content: 'late preview' });
    bot.frame({ type: 'update_message', preview_handle: handle, content: 'stale edit' });
    await settle();
    assert.equal(hub.thinking.get(1).size, 0);
    assert.equal(bot.of('preview_ack').at(-1).preview_handle, '');
    assert.deepEqual(hub.store.page(1, undefined, 50).map(m => m.text), ['old preview']);
  }
  ask(hub, '@Bot new'); await settle();
  const ctx = bot.of('message').at(-1).reply_ctx;
  assert.equal(ctx, 'room-1:epoch-1');
  bot.frame({ type: 'reply', reply_ctx: ctx, agent: true, content: 'fresh reply' }); await settle();
  assert.equal(hub.store.page(1, undefined, 1)[0].text, 'fresh reply');
  bot.frame({ type: 'preview_start', ref_id: 'fresh', reply_ctx: ctx, content: 'new preview' });
  const freshHandle = bot.of('preview_ack').at(-1).preview_handle;
  bot.frame({ type: 'update_message', session_key: 'cloud_web:room-1:owner', preview_handle: freshHandle, content: 'new edit' });
  await settle();
  assert.equal(hub.store.message(Number(freshHandle)).text, 'new edit');
  bot.frame({ type: 'delete_message', session_key: 'cloud_web:room-1:owner', preview_handle: freshHandle });
  await settle();
  assert.equal(hub.store.message(Number(freshHandle)), undefined);
});

test('room action HTTP: stop reports one outcome per member, and says when it cannot stop', async t => {
  const { createServer } = await import('node:http');
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }], { stopTimeoutMs: 100 });
  // A cloud-web bot is streaming output in the same room: it has no cancel protocol.
  const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const server = createServer((req, res) => { roomActionRoute(req, res, {
    owner: r => r.headers.authorization === 'test', dsh: members, gateway: gw,
  }).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }).catch(() => { res.writeHead(500); res.end(); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await members.close(); });
  const url = 'http://127.0.0.1:' + server.address().port + '/collab/api/rooms/1/stop';
  const posting = (body, auth = 'test') => fetch(url, { method: 'POST', headers: { authorization: auth }, body: JSON.stringify(body ?? {}) });
  // A connected cloud-web bot that is streaming output right now.
  const cw = connect(gw, 'bot=cw&name=CW');
  cw.frame({ type: 'typing_start', reply_ctx: gw.replyContext(1, 'cw') });
  await settle();
  const res = await posting({});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.output_only, ['cw'], 'the gateway names the member it can only fence');
  assert.deepEqual(body.stopped_members, [{ member: 'cw', outcome: 'unsupported' }]);
  assert.equal(body.cancelled_jobs, 0);
  const notices = hub.store.page(1, undefined, 50).filter(m => m.author_kind === 'system').map(m => m.text);
  assert.equal(notices.at(-1).includes('不支持终止'), true, 'silence would read as a real stop');
  await gw.closeAll();
});

test('room action HTTP: auth, method, missing room, empty POST, stop/continue conflict', async t => {
  const { createServer } = await import('node:http');
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }], { stopTimeoutMs: 100 });
  const server = createServer((req, res) => { roomActionRoute(req, res, {
    owner: r => r.headers.authorization === 'test', dsh: members, gateway: { stopRoom() {} },
  }).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }).catch(e => { res.writeHead(500); res.end(String(e)); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await members.close(); });
  const url = 'http://127.0.0.1:' + server.address().port + '/collab/api/rooms/';
  const call = (path, options = {}) => fetch(url + path, { method: 'POST', headers: { authorization: 'test' }, ...options });
  assert.equal((await call('1/stop', { headers: {} })).status, 401);
  assert.equal((await call('1/stop', { method: 'GET' })).status, 405);
  assert.equal((await call('99/stop')).status, 404);
  ask(hub); await settle(); const agent = dsh.sessions.get(dsh.made[0]); dsh.turn(agent, [], null);
  agent.cancel = () => {}; agent.whenIdle = () => new Promise(() => {});
  const stopping = call('1/stop');
  const deadline = Date.now() + 2000;
  while (!members.stopping.has(1) && Date.now() < deadline) await tick();
  assert.equal(members.stopping.has(1), true, 'HTTP stop reached the driver');
  assert.equal((await call('1/continue')).status, 409);
  assert.deepEqual((await (await stopping).json()).unconfirmed, ['ds']);
  assert.equal((await call('1/continue')).status, 200);
  assert.equal((await call('1/stop')).status, 200);
});

test('DSH member: @ admits one prompt, its turn posts the reply, duplicates never re-run', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '先说一句' });
  const { message: trigger } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 总结一下', clientKey: 'once' });
  assert.equal(hub.store.openJobs().length, 1, 'the job commits with the message, before any async step');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 总结一下', clientKey: 'once' });
  await settle();
  assert.equal(dsh.made.length, 1);
  const agent = dsh.sessions.get(dsh.made[0]);
  assert.equal(agent.prompts.length, 1);
  assert.match(agent.prompts[0].content[0].text, /【我】先说一句\n【我】@DeepSeek 总结一下/);
  assert.deepEqual(dsh.ctx.sessionTitle.renamed, ['#general · DeepSeek']);
  assert.deepEqual(dsh.ctx.agents.created.at(-1).agentOptions, { provider: 'deepseek', model: 'deepseek-v4' }, 'default model is pinned at creation');
  assert.equal(hub.store.job(1).input_id, agent.prompts[0].id);
  assert.equal(hub.thinking.get(1).has('ds'), true);

  dsh.turn(agent, ['草稿', '总结：一切正常']);
  await settle();
  const reply = hub.store.page(1, undefined, 1)[0];
  assert.equal(reply.author, 'ds');
  assert.equal(reply.text, '总结：一切正常');
  assert.equal(hub.thinking.get(1).has('ds'), false);
  assert.equal(hub.store.openJobs().length, 0);
  assert.equal(hub.store.addJob('ds', 1, trigger.id), undefined);

  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 再补一句' });
  await settle();
  assert.equal(dsh.made.length, 1, 'the bound Session is reused');
  assert.equal(agent.prompts.length, 2);
  assert.doesNotMatch(agent.prompts[1].content[0].text, /先说一句/, 'only unseen messages are sent');
});

test('DSH member: a turn started from the DSH Web UI is never posted to the channel', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 第一次' });
  await settle();
  const agent = dsh.sessions.get(dsh.made[0]);
  dsh.turn(agent, ['第一次的回答']);
  await settle();

  // The owner chats with the Session directly in the DSH Web UI: a turn opens without our input.
  const webInput = { id: 'web-1', role: 'user', content: [{ type: 'text', text: '私下的问题' }] };
  dsh.turn(agent, [], null, webInput);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 第二次' });
  await settle();
  // The web turn ends first and carries private text; it must not settle the channel job.
  dsh.emit(agent, 'assistant/message', { message: { content: [{ type: 'text', text: '私聊内容' }] } });
  dsh.emit(agent, 'turn/end', { turn: agent.turns, reason: { kind: 'completed' } });
  await settle();
  assert.ok(!hub.store.page(1, undefined, 20).some(m => m.text === '私聊内容'));
  assert.equal(hub.store.openJobs().length, 1);

  dsh.turn(agent, ['第二次的回答']);
  await settle();
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '第二次的回答');
  assert.equal(hub.store.openJobs().length, 0);
});

test('DSH member: a reply that @s a cloud-web bot is forwarded to it', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 让橘去跑测试' });
  await settle();
  dsh.turn(dsh.sessions.get(dsh.made[0]), ['@橘 请跑一下 go test']);
  await settle();
  const frame = ju.of('message').at(-1);
  assert.equal(frame.from_bot, true);
  assert.equal(frame.mentioned, true);
  assert.equal(frame.content, '【DeepSeek】请跑一下 go test');
});

test('DSH member: a discarded input ends its job and frees the queue', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 一' });
  await settle();
  const agent = dsh.sessions.get(dsh.made[0]);
  members.onDiscarded(agent.session.id, agent.prompts[0].id);
  await settle();
  assert.match(hub.store.page(1, undefined, 1)[0].text, /被取消/);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 二' });
  await settle();
  assert.equal(agent.prompts.length, 2, 'the next job still runs');
});

test('DSH member: user cancellation preserves partial text and aborted reason', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 写长文' });
  await settle();
  dsh.turn(dsh.sessions.get(dsh.made[0]), ['第一段'], { kind: 'aborted', reason: { kind: 'user' } });
  await settle();
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '第一段\n\n（这一轮没有正常结束：aborted：user）');
});

test('DSH member: a failed admission reports the error and leaves no stale watcher', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const realCreate = dsh.ctx.agents.create.bind(dsh.ctx.agents);
  dsh.ctx.agents.create = async (o) => { const h = await realCreate(o); h.agent.followup = () => { throw Error('inbox closed'); }; return h; };
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek hi' });
  await settle();
  assert.equal(members.watching.size, 0);
  const last = hub.store.page(1, undefined, 1)[0];
  assert.equal(last.author_kind, 'system');
  assert.match(last.text, /inbox closed/);
  assert.equal(hub.thinking.get(1).has('ds'), false);
});

test('DSH member: the preset scope is released when Workspace creation fails', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  dsh.ctx.workspaceRegistry.create = async () => { throw Error('no such directory'); };
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek hi' });
  await settle();
  assert.equal(dsh.ctx.agentPresets.released, 1);
  assert.match(hub.store.page(1, undefined, 1)[0].text, /no such directory/);
});

test('DSH member: the prompt always contains the trigger, however much is unread', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  for (let i = 0; i < 300; i++) hub.store.append(1, { authorKind: 'user', author: 'owner', name: '我', text: `旧消息 ${i}` });
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 最新的问题' });
  await settle();
  const text = dsh.sessions.get(dsh.made[0]).prompts[0].content[0].text;
  assert.match(text, /【我】@DeepSeek 最新的问题$/);
  assert.match(text, /旧消息 299/);
  assert.doesNotMatch(text, /旧消息 0\n/);
});

/** Seed one sent job whose Session lives in `dsh`; returns the job and agent. */
async function sentJob(hub, dsh, sessionId, text, member = 'ds') {
  const agent = (await dsh.ctx.agents.create({ sessionId })).agent;
  const t = hub.store.append(1, { authorKind: 'user', author: 'owner', name: '我', text }).message;
  const job = hub.store.addJob(member, 1, t.id);
  hub.store.bind(member, 1, sessionId, '/w/' + member + '/room-1', job.access_stamp);
  const input = { id: `input-${sessionId}`, role: 'user', content: [{ type: 'text', text }] };
  hub.store.markSent(job.id, sessionId, agent.session.seq, input.id, '/w/' + member + '/room-1');
  agent.followup(input);
  return { job, agent, input };
}

test('DSH member recovery: settles from the consuming turn, withdraws unconsumed input, never re-sends', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const done = await sentJob(hub, dsh, 's-done', '@DeepSeek a', 'done');
  dsh.turn(done.agent, ['已完成的回答']);
  // A later Web UI turn in the same Session must not be picked up.
  dsh.turn(done.agent, ['后来网页里的私聊'], { kind: 'completed' }, { id: 'web-2', role: 'user', content: [] });
  const cut = await sentJob(hub, dsh, 's-cut', '@DeepSeek b', 'cut');
  dsh.turn(cut.agent, ['写到一半'], { kind: 'interrupted' });
  const queued = await sentJob(hub, dsh, 's-queued', '@DeepSeek c', 'queued');
  const legacy = hub.store.addJob('ds', 1, hub.store.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek d' }).message.id);
  hub.store.markSent(legacy.id, 's-legacy', 0, null);

  const members = dsh.attach(hub, ['done', 'cut', 'queued', 'ds'].map(id => ({ id, name: id })));
  members.recover();
  await settle();
  const texts = hub.store.page(1, undefined, 20).map(m => `${m.author_kind}:${m.text}`);
  assert.ok(texts.includes('role:已完成的回答'));
  assert.ok(!texts.some(t => t.includes('私聊') || t.includes('写到一半')));
  assert.equal(queued.agent.inbox.nextTurn.length, 0, 'the unconsumed input is withdrawn from the durable inbox');
  assert.ok(texts.some(t => t.includes('还没开始执行，已撤回')));
  assert.equal(hub.store.job(cut.job.id).state, 'interrupted');
  assert.equal(hub.store.job(legacy.id).state, 'interrupted');
  for (const a of [done.agent, cut.agent, queued.agent]) assert.equal(a.prompts.length, 1, 'nothing is re-sent');
  members.recover();
  await settle();
  assert.equal(hub.store.page(1, undefined, 50).length, texts.length, 'recovery is idempotent');
});

test('DSH member recovery: shares the per-member queue with new mentions', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const { job } = await sentJob(hub, dsh, 's-bound', '@DeepSeek 旧');
  hub.store.bind('ds', 1, 's-bound');
  dsh.sessions.delete('s-bound');
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  members.recover();
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 新' });
  await settle();
  assert.equal(dsh.ctx.agents.resumes, 0, 'unloaded Session with uncertain inbox is never resumed');
  assert.equal(hub.store.sessionFenced('s-bound'), true);
  assert.equal(hub.store.job(job.id).state, 'interrupted');
  assert.equal(hub.store.openJobs().length, 1, 'the new job is admitted after recovery');
});

test('DSH member: close drains waiting jobs before the store closes', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  let release;
  dsh.ctx.workspaceRegistry.create = () => new Promise((resolve) => { release = () => resolve({ path: '/w', async attachSession() {} }); });
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek hi' });
  await settle();
  const closing = members.close();
  release();
  await closing;
  hub.store.close();
  await settle();
  assert.equal(dsh.made.length, 0, 'close during workspace await prevents Agent creation');
});

test('relay cap: agent-to-agent mentions stop starting DSH turns until a human speaks', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }], { maxRelay: 2 });
  hub.setMember({ id: 'ju', name: '橘', kind: 'bot', online: true });
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '开始' });
  for (const t of ['一', '二']) hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: `@DeepSeek ${t}` });
  await settle();
  assert.equal(hub.store.openJobs().length, 2, 'mentions within the cap still start jobs');
  hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '@DeepSeek 三' });
  await settle();
  const last = hub.store.page(1, undefined, 1)[0];
  assert.equal(last.author_kind, 'system');
  assert.match(last.text, /连续接力 2 次以上/);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 继续' });
  assert.equal(hub.store.relayDepth(1, hub.store.page(1, undefined, 1)[0].id), 0);
});

test('store: a v1 database migrates to the current schema and keeps its rows', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v1.sqlite3');
  const v2 = new Store(path);
  v2.ensureRoom(1, 'general');
  v2.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'kept' });
  v2.db.exec('ALTER TABLE jobs DROP COLUMN input_id; DROP TABLE members; DROP TABLE relay_blocked; DROP TABLE room_controls; DROP TABLE room_members; ALTER TABLE rooms DROP COLUMN visibility; PRAGMA user_version = 1');
  v2.close();
  const raw = new DatabaseSync(path);
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 1);
  raw.close();
  const reopened = new Store(path);
  assert.equal(reopened.page(1, undefined, 1)[0].text, 'kept');
  const job = reopened.addJob('ds', 1, 1);
  assert.equal(reopened.markSent(job.id, 's', 0, 'in-1'), true);
  assert.equal(reopened.job(job.id).input_id, 'in-1');
  assert.deepEqual(reopened.members(), [], 'v3 members table exists after migration');
  reopened.close();
});

test('finalText picks the last non-empty assistant text', () => {
  assert.equal(finalText([
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'a' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'tool_use', id: 'x' }] } } },
  ]), 'a');
  assert.equal(finalText([]), undefined);
});

test('turn/end reasons render as kind plus error message', () => {
  assert.equal(describeReason({ kind: 'error', error: { message: 'no provider\nconfigured', code: 'X' } }), 'error：no provider configured');
  assert.equal(describeReason({ kind: 'aborted', reason: { kind: 'user' } }), 'aborted：user');
  assert.equal(describeReason(undefined), 'unknown');
});

test('config: absolute paths, unique member ids, token from env only', () => {
  assert.throws(() => resolveConfig({ dataDir: 'rel', workspacePath: '/w' }), /dataDir/);
  assert.throws(() => resolveConfig({ dataDir: '/d', workspacePath: '/w', dshMembers: [{ id: 'owner', name: 'x' }] }), /unique/);
  const c = resolveConfig({ dataDir: '/d', workspacePath: '/w', dshMembers: [{ id: 'ds', name: 'DeepSeek' }] }, { CONEST_COLLAB_BOT_TOKEN: 'tok' });
  assert.equal(c.botToken, 'tok');
  assert.deepEqual(c.rooms, [{ id: 1, name: 'general' }]);
});

test('DSH member: a configured model applies on every request; the default only until the first header', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }, { id: 'relay', name: 'Relay', model: { provider: 'relay', model: 'm1' } }]);
  const run = async (member, hasHeader) => {
    let hook;
    let options;
    members.setup({ on(_name, fn, opts) { hook = fn; options = opts; } }, member);
    assert.deepEqual(options, { prepend: member.model !== undefined }, 'a configured model wraps DSH model selection');
    return hook({ agent: { session: { requestHeader: () => (hasHeader ? {} : undefined) } } }, async () => ({ provider: 'old', model: 'old-model', reasoningEffort: 'high' }));
  };
  assert.deepEqual(await run(members.config.get('relay'), true), { provider: 'relay', model: 'm1' });
  assert.deepEqual(await run(members.config.get('ds'), false), { provider: 'deepseek', model: 'deepseek-v4' });
  assert.deepEqual(await run(members.config.get('ds'), true), { provider: 'old', model: 'old-model', reasoningEffort: 'high' });
});

test('DSH member: a configured model is recorded as the Session selection when it differs', () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'relay', name: 'Relay', model: { provider: 'relay', model: 'm1' } }, { id: 'ds', name: 'DeepSeek' }]);
  const appended = [];
  const agent = (config) => ({ session: { requestHeader: () => (config ? { config } : undefined), append: (type, data) => appended.push([type, data]) } });
  members.syncSelection(agent({ provider: 'deepseek-official', model: 'old' }), members.config.get('relay'));
  members.syncSelection(agent({ provider: 'relay', model: 'm1' }), members.config.get('relay'));
  members.syncSelection(agent(undefined), members.config.get('relay'));
  members.syncSelection(agent({ provider: 'x', model: 'y' }), members.config.get('ds'));
  assert.deepEqual(appended, [['model/selection', { provider: 'relay', model: 'm1' }]]);
});

test('DSH member: a Session already loaded by the DSH Web UI still gets the model hook, once', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'relay', name: 'Relay', model: { provider: 'relay', model: 'm1' } }]);
  const loaded = (await dsh.ctx.agents.create({ sessionId: 's-open' })).agent;
  const hooks = [];
  loaded.ctx = { on: (name, fn, opts) => hooks.push([name, opts]) };
  hub.store.bind('relay', 1, 's-open');
  await members.liveAgent('s-open', members.config.get('relay'));
  await members.liveAgent('s-open', members.config.get('relay'));
  assert.deepEqual(hooks, [['agent/request', { prepend: true }]]);
});

function fakeLlm() {
  return {
    listProviders: () => [{ id: 'relay', name: '中转站' }, { id: 'broken', name: 'Broken' }],
    listModels: async (p) => { if (p === 'broken') throw Error('no key'); return [{ id: 'm1', name: 'Model 1' }]; },
    resolveModelInfo: async (p, m) => { if (p !== 'relay' || m !== 'm1') throw Error('unknown model'); return {}; },
  };
}

test('roster: config seeds are read-only, UI members are created, edited and removed, names stay unique', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, []);
  const roster = new Roster(hub, members, fakeLlm());
  roster.load([{ id: 'ds', name: 'DeepSeek', persona: '严谨' }]);
  assert.equal(members.config.get('ds').persona, '严谨');
  assert.equal(hub.memberView().find(m => m.id === 'ds').editable, false);

  const coder = await roster.create({ name: 'Coder', model: { provider: 'relay', model: 'm1' }, persona: '写代码' });
  assert.equal(coder.id, 'coder');
  assert.deepEqual(members.config.get('coder').model, { provider: 'relay', model: 'm1' });
  assert.equal(hub.memberView().find(m => m.id === 'coder').editable, true);

  await assert.rejects(roster.create({ name: 'deepseek' }), /already used/);
  await assert.rejects(roster.create({ name: 'has space' }), /without spaces/);
  await assert.rejects(roster.create({ name: 'X', model: { provider: 'relay', model: 'nope' } }), /not available/);
  await assert.rejects(roster.update('ds', { name: 'DS2' }), /config file/);
  assert.throws(() => roster.remove('ds'), /config file/);

  const renamed = await roster.update('coder', { name: '码农', model: { provider: 'relay', model: 'm1' }, persona: '' });
  assert.equal(renamed.name, '码农');
  assert.equal(hub.members.get('coder').name, '码农');
  roster.remove('coder');
  assert.equal(members.config.has('coder'), false);
  assert.equal(hub.members.has('coder'), false);
  assert.equal(hub.store.members().some(m => m.id === 'coder'), false);

  const reloaded = fakeDsh().attach(makeHubFrom(hub.store), []);
  new Roster(reloaded.hub, reloaded, fakeLlm()).load([]);
  assert.deepEqual([...reloaded.config.keys()], ['ds'], 'UI members persist; removed ones stay removed');

  const routes = await roster.models();
  assert.deepEqual(routes[0], { provider: 'relay', name: '中转站', models: [{ id: 'm1', name: 'Model 1' }] });
  assert.equal(routes[1].models.length, 0);
  assert.match(routes[1].error, /no key/);
});

function makeHubFrom(store) {
  const hub = new Hub(store, quiet);
  hub.setMember({ id: 'owner', name: '我', kind: 'human', online: true });
  return hub;
}

test('a member edit reaches an already-hooked Session on its next request', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'coder', name: 'Coder', model: { provider: 'relay', model: 'm1' } }]);
  let hook;
  members.setup({ on(_n, fn) { hook = fn; } }, members.config.get('coder'));
  const call = () => hook({ agent: { session: { requestHeader: () => ({}) } } }, async () => ({ provider: 'x', model: 'y' }));
  assert.deepEqual(await call(), { provider: 'relay', model: 'm1' });
  members.putMember({ id: 'coder', name: 'Coder', model: { provider: 'relay', model: 'm2' } });
  assert.deepEqual(await call(), { provider: 'relay', model: 'm2' });
});

test('prompt states the member identity, model and persona', () => {
  const text = promptText({ name: 'general' }, { name: 'DeepSeek', model: { provider: 'relay', model: 'deepseek-v4.1-flash' }, persona: '你是严谨的审稿人' }, [{ name: '橘', text: '我是 Claude' }]);
  assert.match(text, /你是频道 #general 的成员「DeepSeek」。你底层用的模型是 relay\/deepseek-v4\.1-flash。/);
  assert.match(text, /不是你/);
  assert.match(text, /你的人设：\n你是严谨的审稿人/);
  assert.match(text, /【橘】我是 Claude$/);
});

test('cloud-web: a bot may not take a name another member already uses', () => {
  const hub = makeHub();
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const ws = connect(gw, 'bot=imposter&name=DeepSeek');
  assert.equal(ws.of('register_ack')[0].ok, false);
  assert.equal(ws.closed.code, 4002);
});

test('stop: an unloaded agent reports not running instead of claiming it is not a DSH task', async () => {
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  ask(hub); await settle();
  // The Agent is gone: nothing was running for this member, so nothing was cancelled.
  dsh.sessions.delete(dsh.made[0]);
  const result = await members.stopRoom(1);
  await settle();
  // Nothing to confirm does not mean "could not confirm": it was never running.
  assert.deepEqual(result.unconfirmed, []);
  const notice = hub.store.page(1, undefined, 50).filter(m => m.name === 'system').at(-1);
  assert.match(notice.text, /本来就没在跑/);
  // A DSH member never gets the mislabeled "not a DSH task" line.
  assert.doesNotMatch(notice.text, /不是 DSH 任务/);
  await members.close();
});

test('cloud-web: a reply from the stopped turn epoch is dropped even without the agent mark', async () => {
  const hub = makeHub(); const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const bot = connect(gw, 'bot=b&name=Bot');
  ask(hub, '@Bot first'); await settle();
  const before = bot.of('message').at(-1).reply_ctx;
  bot.frame({ type: 'typing_start', reply_ctx: before });
  hub.stopRoom(1); gw.stopRoom(1);
  await settle();
  // The bridge failed to mark turn output, but the old epoch still proves it is the stopped turn's.
  bot.frame({ type: 'reply', reply_ctx: before, content: '迟到输出，没标 agent' });
  await settle();
  assert.equal(hub.store.page(1, undefined, 50).some(m => m.text.startsWith('迟到输出，没标 agent')), false);
  // A proactive message carries no epoch at all: it is not the stopped turn and must land.
  bot.frame({ type: 'reply', session_key: 'p:room-1', content: '定时任务：该喝水了' });
  await settle();
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '定时任务：该喝水了');
});

// --- #55 private threads: credentials, room membership, per-member workspaces ---

/** A hub with one public room (1) and one private room (2) that only 'ju' may see. */
function makePrivateHub() {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  store.ensureRoom(2, 'secret');
  store.setVisibility(2, 'private');
  store.addRoomMember(2, 'ju');
  const hub = new Hub(store, quiet);
  hub.setMember({ id: 'owner', name: '我', kind: 'human', online: true });
  return hub;
}

test('store: a private room admits its members and the owner, nobody else', () => {
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  store.ensureRoom(2, 'secret');
  store.setVisibility(2, 'private');
  store.addRoomMember(2, 'ju');
  assert.equal(store.canAccess('owner', 2), true, 'the human owner bypasses membership');
  assert.equal(store.canAccess('ju', 2), true);
  assert.equal(store.canAccess('gge', 2), false);
  assert.equal(store.canAccess('gge', 1), true, 'public rooms stay open to every member');
  assert.equal(store.canAccess('ju', 99), false, 'an unknown room admits nobody');
  assert.deepEqual(store.roomsFor('gge').map(r => r.id), [1]);
  assert.deepEqual(store.roomsFor('ju').map(r => r.id), [1, 2]);
  assert.deepEqual(store.roomsFor('owner').map(r => r.id), [1, 2]);
});

test('cloud-web: a bot credential decides identity, and a mismatched bot id is refused', () => {
  const hub = makePrivateHub();
  const gw = new CloudWebGateway(hub, { tokens: new Map([['ju-secret', 'ju'], ['gge-secret', 'gge']]), logger: quiet });
  // The credential says 'ju'; the URL claiming to be 'gge' must not be believed.
  const spoof = connect(gw, 'bot=gge&name=gg', { authorization: 'Bearer ju-secret' });
  assert.equal(spoof.sent.at(-1).ok, false);
  assert.equal(spoof.closed.code, 4002);
  // The same credential with no bot= registers as the credential's member.
  const real = connect(gw, 'name=Ju', { 'x-cloud-web-token': 'ju-secret' });
  assert.equal(real.sent.at(-1).ok, true);
  assert.equal(hub.members.get('ju').kind, 'bot');
  assert.equal(hub.members.get('gge'), undefined, 'nobody registered under the spoofed id');
});

test('cloud-web: history of a private room is 403 for a non-member', async () => {
  const hub = makePrivateHub();
  hub.post(2, { authorKind: 'user', author: 'owner', name: '我', text: 'secret words' });
  const gw = new CloudWebGateway(hub, { tokens: new Map([['gge-secret', 'gge'], ['ju-secret', 'ju']]), logger: quiet });
  assert.equal(gw.identify({ authorization: 'Bearer gge-secret' }).memberId, 'gge');
  // The route decides; assert the predicate it uses rather than the HTTP plumbing.
  assert.equal(hub.store.canAccess('gge', 2), false);
  assert.equal(hub.store.canAccess('ju', 2), true);
  const row = hub.store.page(2, undefined, 10)[0];
  assert.equal(row.text, 'secret words');
});

test('cloud-web: a non-member receives no frames from a private room', async () => {
  const hub = makePrivateHub();
  const gw = new CloudWebGateway(hub, { tokens: new Map([['ju-secret', 'ju'], ['gge-secret', 'gge']]), logger: quiet });
  const ju = connect(gw, 'name=Ju', { authorization: 'Bearer ju-secret' });
  const gge = connect(gw, 'name=Gge', { authorization: 'Bearer gge-secret' });
  ju.sent.length = 0;
  gge.sent.length = 0;
  hub.post(2, { authorKind: 'user', author: 'owner', name: '我', text: 'only ju sees this' });
  // Hub delivers to message listeners on the next microtask, not synchronously.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ju.sent.filter(f => f.type === 'message').length, 1, 'the member is told');
  assert.equal(gge.sent.filter(f => f.type === 'message').length, 0, 'the outsider hears nothing');
});

test('cloud-web: a non-member cannot post, type or preview into a private room', async () => {
  const hub = makePrivateHub();
  const gw = new CloudWebGateway(hub, { tokens: new Map([['gge-secret', 'gge']]), logger: quiet });
  const gge = connect(gw, 'name=Gge', { authorization: 'Bearer gge-secret' });
  const before = hub.store.page(2, undefined, 50).length;
  await gw.fromBot(gw.bots.get('gge'), { type: 'reply', content: 'sneaking in', reply_ctx: 'room-2' });
  await gw.fromBot(gw.bots.get('gge'), { type: 'typing_start', reply_ctx: 'room-2' });
  assert.equal(hub.store.page(2, undefined, 50).length, before, 'no message was written');
  assert.equal(hub.thinking.get(2)?.has('gge') ?? false, false, 'no typing state was set');
  assert.equal(gge.sent.some(f => f.type === 'message'), false);
});

test('cloud-web: a bot cannot stop a room it is not a member of', async () => {
  const hub = makePrivateHub();
  const gw = new CloudWebGateway(hub, { tokens: new Map([['gge-secret', 'gge']]), logger: quiet });
  connect(gw, 'name=Gge', { authorization: 'Bearer gge-secret' });
  await gw.fromBot(gw.bots.get('gge'), { type: 'room_control', action: 'stop', reply_ctx: 'room-2' });
  assert.equal(hub.store.control(2).stopped, 0, 'the private room was not stopped by an outsider');
});

test('cloud-web: the shared token reaches no private room, for reading or writing', async () => {
  const hub = makePrivateHub();
  const gw = new CloudWebGateway(hub, { token: 'shared', logger: quiet });
  const shared = connect(gw, 'bot=gge&name=Gge', { authorization: 'Bearer shared' });
  assert.equal(shared.sent.at(-1).ok, false, 'shared credentials cannot register a writer');
  assert.equal(gw.bots.size, 0);
  assert.equal(gw.identify({ authorization: 'Bearer shared' }).shared, true, 'shared credentials remain available for public HTTP history');
});

test('cloud-web: one bot cannot edit or delete another bot message', async () => {
  const hub = makePrivateHub();
  hub.setMember({ id: 'ju', name: 'Ju', kind: 'bot', mentionId: '', online: true });
  const gw = new CloudWebGateway(hub, { tokens: new Map([['ju-secret', 'ju'], ['gge-secret', 'gge']]), logger: quiet });
  connect(gw, 'name=Ju', { authorization: 'Bearer ju-secret' });
  connect(gw, 'name=Gge', { authorization: 'Bearer gge-secret' });
  const posted = hub.post(1, { authorKind: 'role', author: 'ju', name: 'Ju', text: 'mine' });
  const handle = String(posted.message.id);
  await gw.fromBot(gw.bots.get('gge'), { type: 'update_message', preview_handle: handle, content: 'hijacked' });
  await gw.fromBot(gw.bots.get('gge'), { type: 'delete_message', preview_handle: handle });
  const row = hub.store.message(Number(handle));
  assert.equal(row.text, 'mine', 'the text is untouched');
  assert.equal(row.deleted, 0, 'the message is not deleted');
});

test('dsh-member: each member Session is created in its own directory', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const made = [];
  dsh.ctx.workspaceRegistry.create = async path => { made.push(path); return { path, async attachSession() {} }; };
  dsh.attach(hub, [{ id: 'ju', name: 'Ju' }, { id: 'gge', name: 'Gge' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@Ju 你好' });
  await settle();
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@Gge 你好' });
  await settle();
  assert.equal(made.length >= 2, true, `expected two workspaces, saw ${JSON.stringify(made)}`);
  assert.equal(new Set(made).size, made.length, `no two members may share a directory: ${JSON.stringify(made)}`);
  for (const path of made) assert.match(path, /\/(ju|gge)\/room-1$/);
});

test('dsh-member: workspace names are refused, never rewritten, when they are not slugs', () => {
  const store = new Store(':memory:');
  const dsh = new DshMembers(makeHubFrom(store), { ctx: {}, createUserMessage: () => {}, workspacePath: '/tmp/ws-root', logger: quiet }, [], {});
  assert.equal(dsh.workspaceFor({ id: 'ju' }, 1), '/tmp/ws-root/ju/room-1');
  for (const bad of ['../etc', 'a/b', '/abs', '', 'A', 'x'.repeat(33), 'a.b']) {
    assert.throws(() => dsh.workspaceFor({ id: bad }, 1), /workspace|member id/, `refused: ${JSON.stringify(bad)}`);
  }
});

test('cloud-web: stop recalls the latest message ids sent to each bot, then forgets them', async () => {
  const hub = makeHub(); const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const bot = connect(gw, 'bot=b&name=Bot');
  const other = connect(gw, 'bot=c&name=Cee');
  for (let i = 0; i < 8; i++) ask(hub, `@Bot m${i}`);
  await settle();
  const sent = bot.of('message').map(f => f.msg_id);
  assert.equal(sent.length, 8);
  assert.match(sent[0], /^hub-\d+$/);
  const result = gw.stopRoom(1);
  // Only the newest six can still be running or queued in cc-connect (queue 5 + 1 running).
  const recalls = bot.of('message_recall');
  assert.deepEqual(recalls.map(f => f.msg_id), sent.slice(-6));
  assert.ok(recalls.every(f => f.chat_id === 'room-1'));
  assert.deepEqual(other.of('message_recall').map(f => f.msg_id), other.of('message').map(f => f.msg_id).slice(-6));
  assert.deepEqual([...result.recalled].sort(), ['b', 'c']);
  assert.deepEqual(result.outputOnly, []);
  // The records are spent: a second stop recalls nothing.
  const again = gw.stopRoom(1);
  assert.deepEqual(again.recalled, []);
  assert.equal(bot.of('message_recall').length, 6);
  // A bot that disconnects takes its records with it.
  hub.continueRoom(1);
  ask(hub, '@Bot after continue'); await settle();
  bot.close();
  const back = connect(gw, 'bot=b&name=Bot');
  const third = gw.stopRoom(1);
  assert.deepEqual(back.of('message_recall'), []);
  assert.deepEqual(third.recalled, ['c']);
});

test('room action HTTP: a thinking bot that got a recall is requested, one without records is unsupported', async t => {
  const { createServer } = await import('node:http');
  const hub = makeHub(); const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }], { stopTimeoutMs: 100 });
  const gw = new CloudWebGateway(hub, { token: 't', tokens: fixtureTokens(), logger: quiet });
  const server = createServer((req, res) => { roomActionRoute(req, res, {
    owner: r => r.headers.authorization === 'test', dsh: members, gateway: gw,
  }).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }).catch(() => { res.writeHead(500); res.end(); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await members.close(); });
  const cw = connect(gw, 'bot=cw&name=CW');
  ask(hub, '@CW go'); await settle();
  const delivered = cw.of('message').at(-1).msg_id;
  // cx connects after the message went out: it is thinking, but nothing was delivered to recall.
  const cx = connect(gw, 'bot=cx&name=CX');
  cw.frame({ type: 'typing_start', reply_ctx: gw.replyContext(1, 'cw') });
  cx.frame({ type: 'typing_start', reply_ctx: gw.replyContext(1, 'cx') });
  await settle();
  const res = await fetch('http://127.0.0.1:' + server.address().port + '/collab/api/rooms/1/stop',
    { method: 'POST', headers: { authorization: 'test' }, body: '{}' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.recalled, ['cw']);
  assert.deepEqual(cw.of('message_recall').map(f => f.msg_id), [delivered]);
  assert.deepEqual(cx.of('message_recall'), []);
  const outcome = Object.fromEntries(body.stopped_members.map(r => [r.member, r.outcome]));
  assert.deepEqual(outcome, { cw: 'requested', cx: 'unsupported' });
  const notice = hub.store.page(1, undefined, 50).filter(m => m.author_kind === 'system').at(-1).text;
  assert.match(notice, /已请求停止、未确认退出：CW/);
  assert.match(notice, /不支持终止、只屏蔽旧输出：CX/);
  await gw.closeAll();
});

// --- schema migrations must be structural, not version-gated ---

/** Every table and column the current code relies on. */
function assertCompleteSchema(store) {
  const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  for (const t of ['rooms', 'messages', 'bindings', 'jobs', 'members', 'room_controls', 'relay_blocked', 'room_members']) {
    assert.equal(tables.includes(t), true, `missing table ${t}`);
  }
  assert.equal(store.hasColumn('jobs', 'input_id'), true, 'missing jobs.input_id');
  assert.equal(store.hasColumn('members', 'cli'), true, "missing owner's members.cli");
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.equal(store.hasColumn('rooms', 'visibility'), true, 'missing rooms.visibility');
}

test('store: a fresh database gets the complete schema', () => {
  const store = new Store(':memory:');
  assertCompleteSchema(store);
  store.close();
});

test("store: a database stopped at owner's v4 (cli column, no room tables) upgrades", async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'ownerv4.sqlite3');
  // Build their v4: members already carries cli, the room tables were never created.
  const store = new Store(path);
  store.db.exec('DROP TABLE room_controls; DROP TABLE relay_blocked; PRAGMA user_version = 4');
  store.close();
  const reopened = new Store(path);
  assertCompleteSchema(reopened);
  // The upgraded database must actually work, not merely look right.
  reopened.ensureRoom(1, 'general');
  assert.equal(reopened.control(1).stopped, 0);
  reopened.close();
});

test('store: a database stopped at our old v4 (room tables, no cli column) upgrades', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'ourv4.sqlite3');
  const store = new Store(path);
  store.db.exec('ALTER TABLE members DROP COLUMN cli; PRAGMA user_version = 4');
  store.close();
  const reopened = new Store(path);
  assertCompleteSchema(reopened);
  reopened.ensureRoom(1, 'general');
  // Exercise the columns the two v4 variants disagreed about.
  reopened.seedMember({ id: 'ds', name: 'DeepSeek' });
  assert.equal(reopened.member('ds').name, 'DeepSeek');
  reopened.close();
});

test('store: a database stamped current but missing structure is still repaired', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'stamped.sqlite3');
  // The dangerous case: the version number is already ours, so a version-gated migration
  // would skip everything and the first query on the missing table would throw at runtime.
  const store = new Store(path);
  store.db.exec('DROP TABLE room_controls; DROP TABLE relay_blocked; ALTER TABLE members DROP COLUMN cli');
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 6);
  store.close();
  const reopened = new Store(path);
  assertCompleteSchema(reopened);
  reopened.ensureRoom(1, 'general');
  assert.equal(reopened.control(1).stopped, 0);
  reopened.close();
});
