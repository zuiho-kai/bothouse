import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { forDisplay, forMember, mentions, nameCalled } from './mentions.mjs';
import { CloudWebGateway, CAPABILITIES, progressCard, PROGRESS_PREFIX } from './cloudweb.mjs';
import { DshMembers, finalText, describeReason, friendlyFailure } from './dsh-member.mjs';
import { resolveConfig } from './plugin.mjs';
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

function connect(gateway, query) {
  const ws = new FakeWs();
  gateway.accept(ws, new URL(`http://x/cloud-web/ws?${query}`));
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
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
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

test('cloud-web: token check accepts bearer, header, or query', () => {
  const gw = new CloudWebGateway(makeHub(), { token: 'secret', logger: quiet });
  const url = q => new URL(`http://x/cloud-web/ws${q}`);
  assert.equal(gw.authorized({ headers: { authorization: 'Bearer secret' } }, url('')), true);
  assert.equal(gw.authorized({ headers: { 'x-cloud-web-token': 'secret' } }, url('')), true);
  assert.equal(gw.authorized({ headers: {} }, url('?token=secret')), true);
  assert.equal(gw.authorized({ headers: { authorization: 'Bearer nope' } }, url('?token=secret')), false);
  assert.equal(new CloudWebGateway(makeHub(), { token: '', logger: quiet }).authorized({ headers: {} }, url('?token=')), false);
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
function fakeDsh() {
  const sessions = new Map();
  const made = [];
  let ids = 0;
  let members;
  const agentFor = (id) => {
    const session = { id, events: [], get seq() { return this.events.length; }, snapshotEvents(from = 0) { return this.events.slice(from); }, requestHeader() { return undefined; } };
    const pending = [];
    const agent = {
      session, prompts: [], turns: 0, ctx: { on() {} },
      followup(m) { this.prompts.push(m); pending.push(m); },
      inbox: { get nextTurn() { return pending; }, remove(id) { const i = pending.findIndex(m => m.id === id); if (i < 0) return false; pending.splice(i, 1); return true; } },
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
      agent.inbox.remove(input.id);
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
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
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

test('DSH member: partial text of an aborted turn is posted with an unfinished marker', async () => {
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
  assert.match(hub.memberView().find(m => m.id === 'ds').error, /inbox closed/);
  assert.equal(JSON.parse(last.card).action, 'configure-model');
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
async function sentJob(hub, dsh, sessionId, text) {
  const agent = (await dsh.ctx.agents.create({ sessionId })).agent;
  const t = hub.store.append(1, { authorKind: 'user', author: 'owner', name: '我', text }).message;
  const job = hub.store.addJob('ds', 1, t.id);
  const input = { id: `input-${sessionId}`, role: 'user', content: [{ type: 'text', text }] };
  hub.store.markSent(job.id, sessionId, agent.session.seq, input.id);
  agent.followup(input);
  return { job, agent, input };
}

test('DSH member recovery: settles from the consuming turn, withdraws unconsumed input, never re-sends', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const done = await sentJob(hub, dsh, 's-done', '@DeepSeek a');
  dsh.turn(done.agent, ['已完成的回答']);
  // A later Web UI turn in the same Session must not be picked up.
  dsh.turn(done.agent, ['后来网页里的私聊'], { kind: 'completed' }, { id: 'web-2', role: 'user', content: [] });
  const cut = await sentJob(hub, dsh, 's-cut', '@DeepSeek b');
  dsh.turn(cut.agent, ['写到一半'], { kind: 'interrupted' });
  const queued = await sentJob(hub, dsh, 's-queued', '@DeepSeek c');
  const legacy = hub.store.addJob('ds', 1, hub.store.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek d' }).message.id);
  hub.store.markSent(legacy.id, 's-legacy', 0, null);

  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
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
  assert.equal(dsh.ctx.agents.maxActive, 1, 'recovery and the new job never resume the Session concurrently');
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
  assert.equal(dsh.made.length, 1, 'the in-flight create finished but admitted nothing after close');
  assert.equal(dsh.sessions.get(dsh.made[0]).prompts.length, 0);
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
  v2.db.exec('ALTER TABLE jobs DROP COLUMN input_id; ALTER TABLE messages DROP COLUMN draft; DROP TABLE members; PRAGMA user_version = 1');
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
  assert.equal(reopened.page(1, undefined, 1)[0].draft, 0, 'v6 old rows are not drafts');
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
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ws = connect(gw, 'bot=imposter&name=DeepSeek');
  assert.equal(ws.of('register_ack')[0].ok, false);
  assert.equal(ws.closed.code, 4002);
});

test('roster: a local CLI member is created without a model check and survives reload', async () => {
  const hub = makeHub();
  const members = fakeDsh().attach(hub, []);
  const llm = fakeLlm();
  llm.resolveModelInfo = async () => { throw new Error('model check must be skipped for cli members'); };
  const roster = new Roster(hub, members, llm);
  roster.load([]);
  const cc = await roster.create({ name: 'CC', cli: 'claude', persona: '本地' });
  assert.deepEqual(cc, { id: 'cc', name: 'CC', cli: 'claude', persona: '本地', source: 'ui' });
  assert.equal(hub.store.member('cc').cli, 'claude');
  assert.equal(hub.memberView().find(m => m.id === 'cc').cli, 'claude');
  await assert.rejects(roster.create({ name: 'Bad', cli: 'vim' }), /cli must be one of/);
  const edited = await roster.update('cc', { name: 'CC', cli: 'codex' });
  assert.equal(edited.cli, 'codex');
  const reloaded = fakeDsh().attach(makeHubFrom(hub.store), []);
  new Roster(reloaded.hub, reloaded, fakeLlm()).load([]);
  assert.equal(reloaded.config.get('cc').cli, 'codex');
});

test('store: a v3 database gains the cli column and keeps its members', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v3.sqlite3');
  const s = new Store(path);
  s.addMember({ id: 'old', name: 'Old', model: { provider: 'relay', model: 'm1' } });
  s.db.exec('ALTER TABLE members DROP COLUMN avatar; ALTER TABLE members DROP COLUMN cli; ALTER TABLE messages DROP COLUMN draft; PRAGMA user_version = 3');
  s.close();
  const up = new Store(path);
  assert.equal(up.db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.equal(up.member('old').cli, null);
  assert.equal(up.member('old').model, 'm1');
  assert.equal(up.addMember({ id: 'gm', name: 'GM', cli: 'gemini' }).cli, 'gemini');
  assert.deepEqual(up.members().map(m => m.id), ['old', 'gm']);
  up.close();
});

test('clis: detection lists installed CLIs in order; handler answers GET with [{cli, path}]', async () => {
  const { detectClis, handler } = await import('./clis.mjs');
  const paths = { codex: '/usr/local/bin/codex', claude: '/opt/bin/claude' };
  const lookup = async name => paths[name];
  assert.deepEqual(await detectClis(lookup), [{ cli: 'claude', path: '/opt/bin/claude' }, { cli: 'codex', path: '/usr/local/bin/codex' }]);
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  await handler({ method: 'GET' }, res, lookup);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), [{ cli: 'claude', path: '/opt/bin/claude' }, { cli: 'codex', path: '/usr/local/bin/codex' }]);
  await handler({ method: 'POST' }, res, lookup);
  assert.equal(res.status, 405);
  const real = await detectClis();
  for (const c of real) assert.ok(c.path.startsWith('/'), `real which gives absolute path for ${c.cli}`);
});

test('roster: wizard roles are imported once, existing names skipped', async () => {
  const { mkdtempSync, writeFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'collab-wiz-'));
  const file = join(dir, 'wizard-members.json');
  writeFileSync(file, JSON.stringify({ members: [{ name: '橘', cli: 'claude', persona: '大姐头', avatar: 'orange' }, { name: 'DeepSeek' }, { name: '鲸鱼娘' }] }));
  const hub = makeHub();
  const members = fakeDsh().attach(hub, []);
  const roster = new Roster(hub, members, fakeLlm());
  roster.load([{ id: 'ds', name: 'DeepSeek' }]);
  assert.deepEqual(await roster.importWizard(file), ['橘', '鲸鱼娘']);
  const ju = hub.memberView().find(m => m.name === '橘');
  assert.equal(members.config.get(ju.id).cli, 'claude');
  assert.equal(members.config.get(ju.id).persona, '大姐头');
  assert.equal(members.config.get(ju.id).avatar, 'orange');
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(join(dir, 'wizard-members.imported.json')), true);
  assert.deepEqual(await roster.importWizard(file), []);
});


test('member failure publishes actionable error and clears it on retry', () => {
  const hub = makeHub();
  const members = fakeDsh().attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const trigger = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: 'hello' }).message;
  const job = hub.store.addJob('ds', 1, trigger.id);
  members.fail(job.id, 'No API key configured');
  assert.match(hub.memberView().find(m => m.id === 'ds').error, /没有配置.*Key/);
  assert.equal(hub.memberView().find(m => m.id === 'ds').online, false);
  const notice = hub.store.page(1, undefined, 1)[0];
  assert.equal(JSON.parse(notice.card).action, 'configure-model');
  hub.setThinking(1, 'ds', true);
  assert.equal(hub.memberView().find(m => m.id === 'ds').error, undefined);
});

test('member errors explain setup failures and publish error presence', () => {
  assert.match(friendlyFailure('no API key configured'), /API Key/);
  assert.match(friendlyFailure('model not found'), /模型暂时不可用/);
  assert.match(friendlyFailure('CLI login required'), /登录/);
  assert.match(friendlyFailure('process exited 1'), /CLI/);
  assert.match(friendlyFailure('inbox closed'), /原始错误：inbox closed/);
  const hub = makeHub();
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  hub.setError('ds', 'missing key');
  assert.equal(hub.memberView().find(m => m.id === 'ds').error, 'missing key');
  hub.setError('ds', undefined);
  assert.equal(hub.memberView().find(m => m.id === 'ds').error, undefined);
});

test('store: a v4 database gains the avatar column and keeps its members', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v4.sqlite3');
  const s = new Store(path);
  s.addMember({ id: 'old', name: 'Old', cli: 'claude' });
  s.db.exec('ALTER TABLE members DROP COLUMN avatar; ALTER TABLE messages DROP COLUMN draft; PRAGMA user_version = 4');
  s.close();
  const up = new Store(path);
  assert.equal(up.db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.equal(up.member('old').avatar, null);
  assert.equal(up.member('old').cli, 'claude');
  assert.equal(up.addMember({ id: 'w', name: 'W', avatar: 'whale' }).avatar, 'whale');
  up.close();
});

test('avatars: members pick one of the five built-in avatars; it survives reload and reaches memberView', async () => {
  const { AVATARS, avatarImage } = await import('./avatars.mjs');
  assert.deepEqual(AVATARS, ['orange', 'whale', 'dragon', 'rainbow', 'lanxi']);
  for (const slug of AVATARS) assert.equal(avatarImage(slug).subarray(1, 4).toString(), 'PNG');
  assert.equal(avatarImage('../plugin'), undefined);
  const hub = makeHub();
  const members = fakeDsh().attach(hub, []);
  const roster = new Roster(hub, members, fakeLlm());
  roster.load([{ id: 'ds', name: 'DeepSeek', avatar: 'whale' }]);
  assert.equal(hub.memberView().find(m => m.id === 'ds').avatar, 'whale');
  const cc = await roster.create({ name: 'CC', cli: 'claude', avatar: 'orange' });
  assert.equal(cc.avatar, 'orange');
  assert.equal(hub.memberView().find(m => m.id === 'cc').avatar, 'orange');
  await assert.rejects(roster.create({ name: 'Bad', avatar: 'robot' }), /avatar must be one of/);
  await assert.rejects(roster.create({ name: 'Bad', avatar: 'https://example.com/a.png' }), /avatar must be one of/);
  const plain = await roster.update('cc', { name: 'CC', cli: 'claude', avatar: '' });
  assert.equal(plain.avatar, undefined, 'clearing the avatar falls back to the initial badge');
  assert.equal('avatar' in hub.memberView().find(m => m.id === 'cc'), false);
  await roster.update('cc', { name: 'CC', cli: 'claude', avatar: 'dragon' });
  const reloaded = fakeDsh().attach(makeHubFrom(hub.store), []);
  new Roster(reloaded.hub, reloaded, fakeLlm()).load([]);
  assert.equal(reloaded.hub.memberView().find(m => m.id === 'cc').avatar, 'dragon');
  assert.throws(() => resolveConfig({ dataDir: '/d', workspacePath: '/w', dshMembers: [{ id: 'x', name: 'X', avatar: 'nope' }] }, {}), /avatar must be/);
});

test('cloud-web: a bot announces its avatar as a slug or http(s) URL; junk is dropped', () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  connect(gw, 'bot=ju&name=橘&avatar=orange');
  connect(gw, 'bot=pack&name=Pack&avatar=' + encodeURIComponent('http://127.0.0.1:9820/api/v1/library/avatar-image/senpai'));
  connect(gw, 'bot=junk&name=Junk&avatar=' + encodeURIComponent('javascript:alert(1)'));
  const view = Object.fromEntries(hub.memberView().map(m => [m.id, m.avatar]));
  assert.equal(view.ju, 'orange');
  assert.equal(view.pack, 'http://127.0.0.1:9820/api/v1/library/avatar-image/senpai');
  assert.equal(view.junk, undefined);
});

// #121 streamed replies: a draft row is shown but not fanned out; commit fans out once.
test('hub: a draft is shown but never fanned out; commit writes the full text and fans out once, durably', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'draft.sqlite3');
  const store = new Store(path);
  store.ensureRoom(1, 'general');
  const hub = makeHubFrom(store);
  const seen = []; const planned = []; const pushed = [];
  hub.onMessage(m => seen.push(m.text));
  hub.onPlan(m => { planned.push(m.text); });
  hub.subscribe(e => pushed.push(e));
  const { message: d } = hub.draft(1, { authorKind: 'role', author: 'ju', name: '橘', text: '半句', clientKey: 'k' });
  assert.equal(d.draft, 1);
  assert.equal(hub.draft(1, { authorKind: 'role', author: 'ju', name: '橘', text: '又', clientKey: 'k' }).created, false);
  hub.edit(d.id, 'role', 'ju', '半句话');
  assert.equal(hub.commit(d.id, 'role', 'whale', '冒充', true), undefined, 'only the author commits');
  await tick();
  assert.deepEqual([seen, planned], [[], []], 'drafts and edits reach no agent');
  assert.deepEqual(pushed.map(e => e.message?.text), ['半句', '半句话'], 'browsers see the draft and its edit');
  const row = hub.commit(d.id, 'role', 'ju', '整句话 @鲸鱼娘', true);
  assert.equal(row.id, d.id);
  assert.equal(row.text, '整句话 @鲸鱼娘');
  assert.equal(row.from_turn, 1);
  assert.equal(row.draft, 0);
  await tick();
  assert.deepEqual([seen, planned], [['整句话 @鲸鱼娘'], ['整句话 @鲸鱼娘']]);
  store.close();
  const again = makeHubFrom(new Store(path));
  const seen2 = [];
  again.onMessage(m => seen2.push(m.text));
  assert.equal(again.commit(d.id, 'role', 'ju', '整句话 @鲸鱼娘', true).id, d.id, 'a repeat after restart keeps the row');
  await tick();
  assert.deepEqual(seen2, [], 'a repeat after restart fans out nothing');
  assert.equal(again.store.page(1, undefined, 10).length, 1);
  again.store.close();
});

function cliMembers(hub, ask) {
  const dsh = fakeDsh();
  const agent = { ask };
  return new DshMembers(hub, { ctx: dsh.ctx, createUserMessage: m => m, createCliMember: () => agent, workspacePath: '/w', logger: quiet },
    [{ id: 'cc', name: 'CC', cli: 'claude' }, { id: 'ds', name: 'DeepSeek' }]);
}

test('CLI member streams: first chunk opens a draft, later chunks edit it, the reply commits the same row and hands off', async () => {
  const hub = makeHub();
  let release; const gate = new Promise(r => { release = r; });
  const snapshots = [];
  cliMembers(hub, async (_text, _room, onText) => {
    onText('先看');
    onText('先看日志');
    await tick(); await tick();
    snapshots.push(hub.store.page(1, undefined, 10).filter(m => m.author === 'cc').map(m => m.text));
    snapshots.push(hub.store.openJobs().map(j => j.member_id));
    onText('先看日志，调用工具中…'); // a tool call interrupts the text; the stream continues after it
    await gate;
    onText('先看日志，调用工具中…查完了 @DeepSeek 你接着');
    return '先看日志，调用工具中…查完了 @DeepSeek 你接着';
  });
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 看看' });
  await settle();
  assert.deepEqual(snapshots, [['先看日志'], ['cc']], 'one draft row with the latest text; no teammate job while streaming');
  release();
  await settle();
  const rows = hub.store.page(1, undefined, 10).filter(m => m.author === 'cc');
  assert.equal(rows.length, 1, 'the same row becomes the reply');
  assert.equal(rows[0].text, '先看日志，调用工具中…查完了 @DeepSeek 你接着');
  assert.equal(rows[0].draft, 0);
  assert.equal(hub.store.job(1).state, 'done');
  assert.equal(hub.store.job(1).reply_id, rows[0].id);
  assert.equal(hub.store.job(2).member_id, 'ds', 'the <@teammate> in the final text hands off');
  assert.equal(hub.store.job(2).trigger_id, rows[0].id);
});

test('CLI member streams: an error or cancel removes the draft; no output leaves no row', async () => {
  const hub = makeHub();
  cliMembers(hub, async (_t, _r, onText) => { onText('写了一半'); await tick(); await tick(); throw new Error('boom'); });
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 看看' });
  await settle();
  assert.equal(hub.store.page(1, undefined, 10).filter(m => m.author === 'cc').length, 0, 'error drops the partial draft');
  assert.equal(hub.store.job(1).state, 'failed');

  const hub2 = makeHub();
  let members;
  members = cliMembers(hub2, async (_t, _r, onText) => { onText('写了一半'); await tick(); await tick(); members.closed = true; return '写了一半'; });
  hub2.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 看看' });
  await settle();
  assert.equal(hub2.store.page(1, undefined, 10).filter(m => m.author === 'cc').length, 0, 'cancel drops the partial draft');

  const hub3 = makeHub();
  cliMembers(hub3, async () => '');
  hub3.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 看看' });
  await settle();
  assert.equal(hub3.store.page(1, undefined, 10).filter(m => m.author === 'cc').length, 0);
  assert.equal(hub3.store.job(1).state, 'failed');
});

test('cloud-web reply_in_place: a text preview is a draft; the reply with its handle commits that row and is forwarded once', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘&mention_id=111');
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');
  assert.ok(ju.of('register_ack')[0].capabilities.includes('reply_in_place'));
  ju.frame({ type: 'preview_start', ref_id: 'r1', reply_ctx: 'room-1', content: '先看' });
  const handle = ju.of('preview_ack').at(-1).preview_handle;
  assert.match(handle, /^\d+$/);
  ju.frame({ type: 'update_message', preview_handle: handle, content: '先看日志' });
  await tick(); await tick();
  assert.equal(whale.of('message').length, 0, 'the streaming preview is not forwarded');
  ju.frame({ type: 'reply', reply_ctx: 'room-1', preview_handle: handle, content: '先看日志，查完了 @鲸鱼娘 你接着', agent: true });
  await tick(); await tick();
  const rows = hub.store.page(1, undefined, 10).filter(m => m.author === 'ju');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, Number(handle));
  assert.equal(rows[0].text, '先看日志，查完了 @鲸鱼娘 你接着');
  assert.equal(whale.of('message').length, 1);
  assert.equal(whale.of('message')[0].content, '【橘】先看日志，查完了 你接着');
  ju.frame({ type: 'reply', reply_ctx: 'room-1', preview_handle: handle, content: '先看日志，查完了 @鲸鱼娘 你接着', agent: true });
  await tick(); await tick();
  assert.equal(whale.of('message').length, 1, 'a repeated commit is not forwarded again');
  ju.frame({ type: 'reply', reply_ctx: 'room-1', preview_handle: '999999', content: '预览没了 @鲸鱼娘', agent: true });
  await tick(); await tick();
  assert.equal(hub.store.page(1, undefined, 10).filter(m => m.author === 'ju').length, 2, 'a missing preview falls back to a new row');
  assert.equal(whale.of('message').length, 2);
});
