import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { forDisplay, forMember, mentions, nameCalled } from './mentions.mjs';
import { CloudWebGateway, CAPABILITIES, progressCard, PROGRESS_PREFIX, roomKey } from './cloudweb.mjs';
import { DshMembers, finalText, describeReason, friendlyFailure, memberStatus } from './dsh-member.mjs';
import { resolveConfig, installApprovalAnswerer } from './plugin.mjs';
import { LeadState } from './lead-state.mjs';
import { Roster } from './roster.mjs';
import { promptText, teamModeRules, TurnProgress, workspaceHint } from './dsh-member.mjs';
import { Tasks, CHECK_AFTER_S } from './tasks.mjs';
import { tasksRoute, ownMessageRoute } from './plugin.mjs';
import { TeamExit } from './team-exit.mjs';

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
  assert.equal(s.dispatchMode(1), 'mixed');
  assert.equal(s.setDispatchMode(1, 'team'), 'team');
  assert.equal(s.dispatchMode(1), 'team');
  assert.throws(() => s.setDispatchMode(1, 'bad'), /dispatch mode/);
});

test('dispatch mode: a workspace inherits its chat channel setting (PR #138 review 6)', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  const ws = s.createWorkspace(1);
  assert.equal(s.dispatchMode(ws.id), 'mixed');
  s.setDispatchMode(1, 'solo');
  assert.equal(s.dispatchMode(ws.id), 'solo');
  s.setDispatchMode(ws.id, 'team');
  assert.equal(s.dispatchMode(1), 'team', 'setting a workspace sets its chat channel');
});

test('primary role: shared lead state routes explicitly selected roles and keeps fallback display-only', async () => {
  const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const leadPath = join(mkdtempSync(join(tmpdir(), 'collab-lead-')), 'lead.json');
  const leadState = new LeadState(leadPath, quiet);
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, quiet, leadState, 'ds');
  hub.setMember({ id: 'owner', name: '我', kind: 'human', online: true });
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  hub.setMember({ id: 'ju', name: '橘', kind: 'bot', online: true });
  assert.equal(hub.selectedPrimaryMember(), undefined);
  assert.equal(hub.primaryMember().id, 'ds');
  writeFileSync(leadPath, JSON.stringify({ lead: 'removed' }));
  assert.equal(hub.selectedPrimaryMember(), undefined);
  assert.equal(hub.primaryMember().id, 'ds');

  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');

  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '没有点名的消息', clientKey: 'lead-none' });
  await settle();
  assert.equal(hub.store.openJobs().length, 0, 'fallback is display-only before explicit selection');

  leadState.set('ds', 'DeepSeek');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '没有点名的消息', clientKey: 'lead-dsh' });
  await settle();
  assert.equal(hub.store.openJobs().at(-1).member_id, 'ds');
  assert.equal(ju.of('message').at(-1).mentioned, false);
  assert.equal('lead_id' in ju.of('message').at(-1), false);

  leadState.set('ju', '橘');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '切换后没有点名', clientKey: 'lead-bot' });
  await settle();
  assert.equal(ju.of('message').at(-1).mentioned, false);
  assert.equal('lead_id' in ju.of('message').at(-1), false);
  assert.equal(JSON.parse(readFileSync(leadPath, 'utf8')).lead, 'ju');
});

test('team exit: forwards asks and returns answers to the recorded workspace', async () => {
  const hub = makeHub();
  const ws = hub.store.createWorkspace(1);
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  new TeamExit(hub);
  hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '[ask]\n需要一个答案\n自验：无需\n类别：方向' });
  await tick();
  const forwarded = hub.store.page(1, undefined, 10).find(m => m.author_kind === 'system');
  assert.ok(forwarded);
  assert.match(forwarded.text, /ask-[0-9a-f]{8}/);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: `${forwarded.text.match(/ask-[0-9a-f]{8}/)[0]} 答案是 42` });
  await tick();
  const answer = hub.store.page(ws.id, undefined, 10).find(m => m.author_kind === 'user');
  assert.match(answer.text, /答案是 42/);
  assert.match(answer.text, /^@DeepSeek 用户回复/, 'by name (#597 G37)');
  assert.deepEqual([...mentions(answer.text, hub.routable())], ['ds'], 'the name still routes to the member');
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
  // Same cases as bridge/platform/discord/mentions_test.go TestNameCalled; the team list is
  // passed the way cloudweb.mjs does, so name lists and "和/、/跟/与" behave like Go.
  const team = ['龙娘', '鲸鱼娘', '彩虹猫'];
  const cases = [
    // a line opening with her name: a call
    ['橘，你看这个', true],
    ['橘 你看这个', true],
    ['橘？', true],
    ['橘', true],
    ['橘你来定', true],
    ['Claude橘：你来', true],
    ['龙娘、橘，你们看看', true],
    ['龙娘和橘 你们俩对一下', true],
    ['我算完了\n橘，你核对一下', true], // a later line opening with her name
    // the name inside a sentence: talk about her
    ['行了橘，别贫了', false],
    ['好的，我先等橘回复，这个你怎么看', false],
    ['收到！橘你先忙', false],
    ['那橘你呢', false],
    ['橘说得对', false],
    ['橘在忙，等她', false],
    ['跟橘的审美一样圆', false],
    ['橘子很好吃', false],
    ['```\n橘，\n```', false], // code block
    ['龙娘，你来', false],
    // PR #162 review 2: 和/、 followed by a non-name is not a call
    ['橘和他说过了', false],
    ['橘、龙娘说得对', false],
  ];
  for (const [text, want] of cases) {
    assert.equal(nameCalled(text, 'Claude橘', team), want, JSON.stringify(text));
  }
});

test('cloud-web: register ack, routing, prefixes, no self-echo, reconnect replaces', async () => {
  const hub = makeHub();
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘&mention_id=111');
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');
  assert.deepEqual(ju.of('register_ack')[0], { type: 'register_ack', ok: true, capabilities: [...CAPABILITIES, 'team_workspace'], server: { name: 'conest-dsh-collab' } });

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

  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '橘，你看看这个' });
  await tick();
  assert.equal(ju.of('message').at(-1).mentioned, true, 'a bare name at line start calls the role');
  assert.equal(whale.of('message').at(-1).mentioned, false);

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

test('cloud-web: a line-start name calls a non-primary role', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const leadPath = join(mkdtempSync(join(tmpdir(), 'cloudweb-line-name-')), 'lead.json');
  writeFileSync(leadPath, JSON.stringify({ lead: 'whale', name: '鲸鱼娘' }));
  const store = new Store(':memory:');
  store.ensureRoom(1, 'general');
  const hub = new Hub(store, quiet, new LeadState(leadPath, quiet), 'whale');
  hub.setMember({ id: 'owner', name: '我', kind: 'human', online: true });
  hub.setMember({ id: 'whale', name: '鲸鱼娘', kind: 'bot', online: true });
  hub.setMember({ id: 'ju', name: '橘', kind: 'bot', online: true });
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');

  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '橘，你看看这个', clientKey: 'line-name-sub' });
  await tick();
  assert.equal(ju.of('message').at(-1).mentioned, true, 'the named non-primary role is addressed');
  assert.equal(whale.of('message').at(-1).mentioned, false, 'the selected primary is not addressed by another role name');
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

test('progress card carries a brief view: tool name and outcome per step', () => {
  const c = progressCard(PROGRESS_PREFIX + JSON.stringify({ state: 'running', steps: 3, elapsed_sec: 9, agent: 'Codex', items: [
    { kind: 'thinking', text: 'hmm' },
    { kind: 'tool_use', tool: 'Bash', text: 'go test' }, { kind: 'tool_result', tool: 'Bash', text: 'ok', exit_code: 0 },
    { kind: 'tool_use', tool: 'Edit', text: 'a.go' }, { kind: 'tool_result', tool: 'Edit', text: 'boom', success: false },
    { kind: 'tool_use', tool: 'Read', text: 'b.go' },
  ] }));
  assert.equal(JSON.parse(c.card).brief, '第 3 步 · 9秒\n✅ Bash · 成功\n❌ Edit · 失败\n🔧 Read · 进行中');
  assert.match(c.text, /go test/);
});


/**
 * Minimal DSH runtime. Agents keep a pending inbox and a Session event log;
 * `turn()` plays one real-shaped turn: turn/start, the consumed input as
 * user/message (same id), assistant messages, turn/end — and feeds each event
 * to the driver like the root session/event listener does.
 */
function fakeDsh() {
  const sessions = new Map();
  const unloaded = new Set();
  const deleted = new Set();
  const made = [];
  let ids = 0;
  let members;
  const agentFor = (id) => {
    const session = { id, events: [], get seq() { return this.events.length; }, snapshotEvents(from = 0) { return this.events.slice(from); }, requestHeader() { return undefined; } };
    const pending = [];
    const agent = {
      session, prompts: [], turns: 0, cancels: [], ctx: { on() {} },
      followup(m) { this.prompts.push(m); pending.push(m); },
      cancel(cause, options) { this.cancels.push([cause, options]); },
      inbox: { get nextTurn() { return pending; }, remove(id) { const i = pending.findIndex(m => m.id === id); if (i < 0) return false; pending.splice(i, 1); return true; } },
    };
    sessions.set(id, agent);
    return agent;
  };
  const ctx = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4' }) },
    agents: {
      get: id => (unloaded.has(id) ? undefined : sessions.get(id)),
      created: [], resumes: 0, active: 0, maxActive: 0,
      async create(options) { const agent = agentFor(options.sessionId); made.push(options.sessionId); this.created.push(options); await options.setup?.({ on() {} }); return { agent }; },
      resumedTools: [],
      async resume({ resumeSessionId, setup }) {
        this.resumes++; this.active++; this.maxActive = Math.max(this.maxActive, this.active);
        await tick();
        this.active--;
        if (deleted.has(resumeSessionId)) throw new Error(`session ${resumeSessionId} not found`);
        unloaded.delete(resumeSessionId);
        // Like DSH: a resumed Agent starts with only the built-in tool; its setup adds the rest.
        const resumedCtx = { on() {}, tools: ['working_directory'] };
        await setup?.(resumedCtx);
        this.resumedTools.push(resumedCtx.tools);
        return { agent: sessions.get(resumeSessionId) ?? agentFor(resumeSessionId) };
      },
    },
    agentPresets: { released: 0, async resolve() { return { id: 'default' }; }, async acquireScope() { const p = this; return { async [Symbol.asyncDispose]() { p.released++; } }; }, async mount(agentCtx) { agentCtx.tools?.push('bash', 'read', 'edit'); } },
    permissionPresets: { sets: [], set(session, preset) { this.sets.push([session.id, preset]); } },
    sessionTitle: { renamed: [], rename(s, t) { this.renamed.push(t); } },
    workspaceRegistry: { archivedSessionIds: [], async create(path) { return { path, async attachSession() {} }; } },
    sessionPersistence: { async stat(id) { return deleted.has(id) ? undefined : { header: { id } }; } },
  };
  /** A process restart: every Session is persisted but none is loaded. */
  const restart = () => { for (const id of sessions.keys()) unloaded.add(id); };
  /** The user deletes a Session: it is unloaded and gone from persistence. */
  const remove = (id) => { unloaded.add(id); deleted.add(id); };
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
  return { ctx, sessions, made, emit, turn, attach, restart, remove };
}

const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

test('DSH member: @ admits one prompt, its turn posts the reply, duplicates never re-run', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  hub.store.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '先说一句' });
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

test('DSH member: a new Session is held by the plugin, out of the DSH conversation list', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 你好' });
  await settle();
  assert.equal(dsh.ctx.agents.created.length, 1);
  // DSH's list hides origin "subagent" Sessions (dsh-client-ui-workspace sessionVisible).
  assert.equal(dsh.ctx.agents.created[0].meta.origin, 'subagent');
});

/** Bind ds in room 1 with one answered turn; returns the bound agent. */
async function boundOnce(hub, dsh) {
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 第一次' });
  await settle();
  const agent = dsh.sessions.get(dsh.made[0]);
  dsh.turn(agent, ['第一次的回答']);
  await settle();
  return agent;
}

/** @ ds again and answer the turn; returns the agent that got the prompt. */
async function askAgain(hub, dsh, text) {
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text });
  await settle();
  const agent = dsh.sessions.get(hub.store.binding('ds', 1).session_id);
  dsh.turn(agent, [`回答：${text}`]);
  await settle();
  return agent;
}

for (const [label, lose] of [
  ['archived', (dsh, id) => dsh.ctx.workspaceRegistry.archivedSessionIds.push(id)],
  ['deleted', (dsh, id) => dsh.remove(id)],
]) {
  test(`DSH member: a bound Session that was ${label} is replaced by a new hidden one and the @ is answered`, async () => {
    const hub = makeHub();
    const dsh = fakeDsh();
    dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
    const old = await boundOnce(hub, dsh);
    lose(dsh, old.session.id);
    const agent = await askAgain(hub, dsh, '@DeepSeek 第二次');
    assert.notEqual(agent.session.id, old.session.id, 'a new Session is bound');
    assert.equal(old.prompts.length, 1, 'nothing goes to the lost Session');
    assert.equal(dsh.ctx.agents.created.at(-1).meta.origin, 'subagent');
    assert.equal(hub.store.page(1, undefined, 1)[0].text, '回答：@DeepSeek 第二次');
    assert.equal(hub.store.openJobs().length, 0);
    assert.ok(!hub.store.page(1, undefined, 20).some(m => m.author_kind === 'system'), 'no failure card');
  });
}

test('DSH member: a resume error on a Session that is still there does not rebind it', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const old = await boundOnce(hub, dsh);
  dsh.restart();
  const resume = dsh.ctx.agents.resume;
  dsh.ctx.agents.resume = async () => { throw new Error('corrupt log'); };
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 第二次' });
  await settle();
  dsh.ctx.agents.resume = resume;
  assert.equal(hub.store.binding('ds', 1).session_id, old.session.id, 'the binding keeps the old Session');
  assert.equal(dsh.ctx.agents.created.length, 1, 'no new Session');
  assert.ok(hub.store.page(1, undefined, 20).some(m => m.author_kind === 'system'), 'the failure is shown');
});

test('DSH member: after a restart the resumed Session gets its agent preset tools and permission preset', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek', permissionPreset: 'danger-full-access' }]);
  const old = await boundOnce(hub, dsh);
  dsh.restart();
  dsh.ctx.permissionPresets.sets.length = 0;
  const agent = await askAgain(hub, dsh, '@DeepSeek 重启后 fa');
  assert.equal(agent, old, 'the same Session answers');
  assert.ok(dsh.ctx.agents.resumedTools.at(-1).includes('bash'), 'the agent preset is mounted on resume');
  assert.deepEqual(dsh.ctx.permissionPresets.sets, [[old.session.id, 'danger-full-access']], 'the permission preset is applied on resume');
});

test('DSH member: the request hook is installed once per Agent, after create and after resume, however often it is @-ed', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const setups = [];
  const setup = members.setup.bind(members);
  members.setup = (agentCtx, member, agent) => { setups.push(member.id); return setup(agentCtx, member, agent); };
  const created = await boundOnce(hub, dsh);
  await askAgain(hub, dsh, '@DeepSeek 第二次');
  assert.equal(setups.length, 1, 'created: hooked once');
  // Like DSH, a resume after a restart hands back a new Agent object.
  dsh.restart();
  dsh.sessions.delete(created.session.id);
  const resumed = await askAgain(hub, dsh, '@DeepSeek 重启后一次');
  await askAgain(hub, dsh, '@DeepSeek 重启后两次');
  assert.notEqual(resumed, created);
  assert.equal(setups.length, 2, 'resumed: hooked once more, not on every @');
});

test('DSH member: after a restart a bound hidden Session is resumed, and one deleted meanwhile is replaced', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const old = await boundOnce(hub, dsh);
  dsh.restart();
  const resumes = dsh.ctx.agents.resumes;
  const agent = await askAgain(hub, dsh, '@DeepSeek 重启后');
  assert.equal(agent, old, 'the same Session answers');
  assert.equal(dsh.ctx.agents.resumes, resumes + 1);
  assert.equal(dsh.ctx.agents.created.length, 1);
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '回答：@DeepSeek 重启后');

  dsh.restart();
  dsh.remove(old.session.id);
  const fresh = await askAgain(hub, dsh, '@DeepSeek 删了以后');
  assert.notEqual(fresh.session.id, old.session.id);
  assert.equal(dsh.ctx.agents.created.at(-1).meta.origin, 'subagent');
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '回答：@DeepSeek 删了以后');
});

test('DSH member: /new gives the addressed member a new hidden Session that reads on from /new', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }, { id: 'qw', name: 'Qwen' }]);
  const old = await boundOnce(hub, dsh);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '旧话题' });
  const { message: cmd } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek /new' });
  await settle();
  const fresh = hub.store.binding('ds', 1);
  assert.notEqual(fresh.session_id, old.session.id, '/new rebinds');
  assert.equal(dsh.ctx.agents.created.at(-1).meta.origin, 'subagent');
  assert.equal(fresh.context_cursor, cmd.id, 'the new Session starts after /new');
  assert.equal(old.prompts.length, 1, '/new is not sent to the model');
  assert.equal(hub.store.binding('qw', 1), undefined, 'a member not addressed is left alone');
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '✅ DeepSeek 的新会话已创建');
  const agent = await askAgain(hub, dsh, '@DeepSeek 新话题');
  assert.equal(agent.session.id, fresh.session_id);
  assert.doesNotMatch(agent.prompts[0].content[0].text, /旧话题/);
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

test('DSH member: the answer to the lead\'s dispatch starts with @lead and wakes it', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }, { id: 'coder', name: 'Coder' }]);
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  let lead = 'ju';
  hub.leadState = { selected: () => lead };

  // A cloud-web lead dispatches; the member forgets to @ it back.
  hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '@DeepSeek 跑一下 go test' });
  await settle();
  const ds = dsh.sessions.get(dsh.made[0]);
  dsh.turn(ds, ['测试全过']);
  await settle();
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '@橘 测试全过');
  const frame = ju.of('message').at(-1);
  assert.equal(frame.mentioned, true);
  assert.equal(frame.content, '【DeepSeek】测试全过');

  // Already @-ed: unchanged. A person's @ to the member alone: no lead wake.
  hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '@DeepSeek 再看看' });
  await settle();
  dsh.turn(ds, ['@橘 看完了']);
  await settle();
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '@橘 看完了');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 你好' });
  await settle();
  dsh.turn(ds, ['你好']);
  await settle();
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '你好');

  // A person @-s the member and the lead together: the answer returns to the lead.
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 @DeepSeek 一起看下' });
  await settle();
  dsh.turn(ds, ['看了']);
  await settle();
  assert.equal(hub.store.page(1, undefined, 1)[0].text, '@橘 看了');

  // A DSH member as lead: the hand-back starts the lead's own job.
  lead = 'ds';
  hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '@Coder 改一下' });
  await settle();
  const coder = dsh.sessions.get(dsh.made[1]);
  dsh.turn(coder, ['改好了']);
  await settle();
  const back = hub.store.page(1, undefined, 1)[0];
  assert.equal(back.text, '@DeepSeek 改好了');
  assert.ok(hub.store.openJobs().some(j => j.member_id === 'ds' && j.trigger_id === back.id));
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
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 开始' });
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
  v2.db.exec('ALTER TABLE messages DROP COLUMN reply_to; ALTER TABLE jobs DROP COLUMN input_id; DROP TABLE members; ALTER TABLE messages DROP COLUMN draft; PRAGMA user_version = 1');
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
  const c = resolveConfig({ dataDir: '/d', workspacePath: '/w', dshMembers: [{ id: 'ds', name: 'DeepSeek' }] }, { CONEST_COLLAB_BOT_TOKEN: 'tok', HOME: '/home' });
  assert.equal(c.botToken, 'tok');
  assert.equal(c.leadFile, '/home/.bothouse/lead.json');
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

test('roster: a config member keeps its agent preset and permission preset', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, []);
  new Roster(hub, members, fakeLlm()).load([{ id: 'fa', name: 'FullAccess', agentPreset: 'standard', permissionPreset: 'danger-full-access' }]);
  assert.equal(members.config.get('fa').permissionPreset, 'danger-full-access');
  assert.equal(members.config.get('fa').agentPreset, 'standard');
});

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

test('team rules: a prompt carries only the room mode section (PR #138 review 4, 5)', () => {
  const room = { name: 'general' }, member = { name: 'DeepSeek' };
  const solo = promptText(room, member, [], '', 'solo');
  const team = promptText(room, member, [], '', 'team');
  const mixed = promptText(room, member, []);
  for (const text of [solo, team, mixed]) {
    assert.match(text, /\[团队模式规矩/);
    assert.match(text, /默认达到 3 件就算忙/);
    assert.match(text, /拿不准的设定，不要自己定：在工作区用 \[ask\] 转到聊天频道问用户/);
    assert.match(text, /主角色拿不准也一样/);
    assert.match(text, /写的人不验收自己的活/);
    assert.doesNotMatch(text, /^## /m);
  }
  assert.match(solo, /单模型多进程/);
  assert.doesNotMatch(solo, /先当面派给成员|完全团队|混合/);
  assert.match(team, /完全团队/);
  assert.match(team, /成员空着时先当面派给成员/);
  assert.match(team, /reason 字段/);
  assert.doesNotMatch(team, /单模型多进程|混合/);
  assert.match(mixed, /混合。按这件活谁更合适选人/);
  assert.match(mixed, /成员空着时先当面派给成员/);
  assert.match(mixed, /为什么选这个人/);
  assert.equal(teamModeRules('bogus'), teamModeRules('mixed'));
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

test('roster: editing a CLI member without permissionPreset keeps the stored tier', async () => {
  const hub = makeHub();
  const members = fakeDsh().attach(hub, []);
  const roster = new Roster(hub, members, fakeLlm());
  roster.load([]);
  await roster.create({ name: 'CC', cli: 'claude', permissionPreset: 'danger-full-access' });
  assert.equal(hub.memberView().find(m => m.id === 'cc').permissionPreset, 'danger-full-access');
  const kept = await roster.update('cc', { name: 'CC', cli: 'claude', avatar: 'dragon' });
  assert.equal(kept.permissionPreset, 'danger-full-access', 'absent tier keeps the old one, not the default');
  assert.equal(hub.store.member('cc').permission_preset, 'danger-full-access');
  const changed = await roster.update('cc', { name: 'CC', cli: 'claude', permissionPreset: 'read-only' });
  assert.equal(changed.permissionPreset, 'read-only');
  await assert.rejects(roster.update('cc', { name: 'CC', cli: 'claude', permissionPreset: 'yolo' }), /permissionPreset must be one of/);
});

test('store: a v3 database gains the cli column and keeps its members', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v3.sqlite3');
  const s = new Store(path);
  s.addMember({ id: 'old', name: 'Old', model: { provider: 'relay', model: 'm1' } });
  s.db.exec('ALTER TABLE messages DROP COLUMN reply_to; ALTER TABLE members DROP COLUMN avatar; ALTER TABLE members DROP COLUMN cli; ALTER TABLE messages DROP COLUMN draft; PRAGMA user_version = 3');
  s.close();
  const up = new Store(path);
  assert.equal(up.db.prepare('PRAGMA user_version').get().user_version, 11);
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
  const { mkdtempSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
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
  // each role carries the member id it really has (a Chinese name gets an m-xxxxxx id), for its wiki directory
  const done = JSON.parse(readFileSync(join(dir, 'wizard-members.imported.json'), 'utf8')).members;
  assert.deepEqual(done.map(m => [m.name, m.id]), [['橘', ju.id], ['DeepSeek', 'ds'], ['鲸鱼娘', hub.memberView().find(m => m.name === '鲸鱼娘').id]]);
  assert.match(ju.id, /^m-[a-z0-9]{6}$/);
  assert.deepEqual(await roster.importWizard(file), []);
});


test('member failure publishes actionable error and clears it on retry', () => {
  const hub = makeHub();
  const members = fakeDsh().attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const trigger = hub.store.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'hello' }).message;
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
  s.db.exec('ALTER TABLE messages DROP COLUMN reply_to; ALTER TABLE members DROP COLUMN avatar; ALTER TABLE messages DROP COLUMN draft; PRAGMA user_version = 4');
  s.close();
  const up = new Store(path);
  assert.equal(up.db.prepare('PRAGMA user_version').get().user_version, 11);
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
  const agent = { ask, close() {} };
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

test('a teammate draft that commits later still reaches members whose cursor moved on, and its <@handoff> carries the trigger', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  ju.frame({ type: 'preview_start', ref_id: 'r1', reply_ctx: 'room-1', content: '先看' });
  const handle = ju.of('preview_ack').at(-1).preview_handle;
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 先说别的' });
  await settle();
  const agent = dsh.sessions.get(dsh.made[0]);
  dsh.turn(agent, ['好']);
  await settle();
  assert.ok(hub.store.binding('ds', 1).context_cursor < Number(handle), 'the cursor stops before the uncommitted draft');
  ju.frame({ type: 'reply', reply_ctx: 'room-1', preview_handle: handle, content: '查完了 @DeepSeek 你接着', agent: true });
  await settle();
  const job = hub.store.openJobs().find(j => j.member_id === 'ds');
  assert.equal(job?.trigger_id, Number(handle), 'the commit hands off with the draft row as trigger');
  assert.match(agent.prompts.at(-1).content[0].text, /查完了/, 'the handoff prompt contains the committed reply');
});

test('cloud-web #119 task card survives disconnect/reconnect and keeps editing the same row', () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const card = (state, text) => PROGRESS_PREFIX + JSON.stringify({ version: 2, agent: '📋 整理日志', state, items: [{ kind: 'info', text }] });
  let ju = connect(gw, 'bot=ju&name=橘');
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');
  const before = whale.of('message').length;
  ju.frame({ type: 'preview_start', ref_id: 'taskcard-task-1', reply_ctx: 'room-1', content: card('running', '开始') });
  const handle = ju.of('preview_ack').at(-1).preview_handle;
  assert.match(handle, /^\d+$/);
  assert.equal(whale.of('message').length, before, 'the task card is not broadcast to other bots');
  ju.close(1006, 'gone');
  assert.ok(hub.store.message(Number(handle)), 'a dropped connection keeps the task card');
  ju = connect(gw, 'bot=ju&name=橘');
  assert.ok(hub.store.message(Number(handle)), 're-registering keeps the task card');
  ju.frame({ type: 'update_message', preview_handle: handle, content: card('completed', '完成一半') });
  const row = hub.store.message(Number(handle));
  assert.match(row.text, /完成一半/, 'later edits land on the same row');
  assert.equal(JSON.parse(row.card).state, 'completed');
  assert.equal(whale.of('message').length, before, 'edits are not broadcast either');
});

test('cloud-web #119 task card seq: a retried create refreshes the row, an older frame cannot roll it back', () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const card = (state, text) => PROGRESS_PREFIX + JSON.stringify({ version: 2, agent: '📋 整理日志', state, items: [{ kind: 'info', text }] });
  const ju = connect(gw, 'bot=ju&name=橘');
  ju.frame({ type: 'preview_start', ref_id: 'taskcard-task-1', reply_ctx: 'room-1', content: card('running', '开始'), seq: 1 });
  const handle = ju.of('preview_ack').at(-1).preview_handle;
  // The ack was lost; the bridge retries the create later with newer content.
  ju.frame({ type: 'preview_start', ref_id: 'taskcard-task-1', reply_ctx: 'room-1', content: card('running', '完成一半'), seq: 3 });
  assert.equal(ju.of('preview_ack').at(-1).preview_handle, handle, 'the retry returns the same row');
  let row = hub.store.message(Number(handle));
  assert.match(row.text, /完成一半/, 'the retried create shows its newer content');
  assert.equal(JSON.parse(row.card).seq, 3);
  ju.frame({ type: 'update_message', preview_handle: handle, content: card('running', '旧进度'), seq: 2 });
  row = hub.store.message(Number(handle));
  assert.match(row.text, /完成一半/, 'an older frame is ignored');
  ju.frame({ type: 'update_message', preview_handle: handle, content: card('completed', '完成'), seq: 4 });
  row = hub.store.message(Number(handle));
  assert.match(row.text, /完成/);
  assert.equal(JSON.parse(row.card).state, 'completed');
  assert.equal(JSON.parse(row.card).seq, 4);
  ju.frame({ type: 'preview_start', ref_id: 'taskcard-task-1', reply_ctx: 'room-1', content: card('running', '开始'), seq: 1 });
  assert.equal(JSON.parse(hub.store.message(Number(handle)).card).state, 'completed', 'a delayed first create does not reopen a finished card');
});

test('interrupted streams leave no draft: cloud-web disconnect/reconnect and a CLI job settled after restart', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const live = () => hub.store.page(1, undefined, 20).filter(m => m.draft === 1).map(m => m.author);
  let ju = connect(gw, 'bot=ju&name=橘');
  ju.frame({ type: 'preview_start', ref_id: 'r1', reply_ctx: 'room-1', content: '写了一半' });
  assert.deepEqual(live(), ['ju']);
  ju.close(1006, 'gone');
  assert.deepEqual(live(), [], 'a dropped connection removes its text draft');
  // A hub restart: the draft survives in the store until the bot registers again.
  hub.draft(1, { authorKind: 'role', author: 'ju', name: '橘', text: '重启前的半句', clientKey: 'preview:ju:r2' });
  assert.deepEqual(live(), ['ju']);
  ju = connect(gw, 'bot=ju&name=橘');
  assert.deepEqual(live(), [], 'a (re)register removes leftover text drafts');

  const job = hub.store.addJob('cc', 1, hub.store.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 看看' }).message.id);
  hub.store.markSent(job.id, 'cli:claude', 0, undefined);
  hub.draft(1, { authorKind: 'role', author: 'cc', name: 'CC', text: '半截', clientKey: `dsh-job-${job.id}` });
  const members = cliMembers(hub, async () => 'unused');
  members.recover();
  await settle();
  assert.equal(hub.store.job(job.id).state, 'interrupted');
  assert.deepEqual(live(), [], 'the interrupted CLI job drops its streamed draft');
});

test('cloud-web #120: permission prompt → button → card_action → card state; duplicates, expiry, offline', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const bot = connect(gw, 'bot=dou&name=大豆包');
  assert.ok(CAPABILITIES.includes('buttons'));
  const buttons = [[{ Text: '允许', Data: 'perm:allow' }, { Text: '拒绝', Data: 'perm:deny' }], [{ Text: '允许所有 (本次会话)', Data: 'perm:allow_all' }]];
  const prompt = (sk = 'cloud_web:room-1') => bot.frame({ type: 'buttons', session_key: sk, reply_ctx: 'room-1', content: '⚠️ **权限请求** run_command\n回复 **允许** / **拒绝** / **允许所有**', buttons });
  prompt();
  await tick();
  const first = hub.store.page(1).at(-1);
  const card = JSON.parse(first.card);
  assert.equal(card.kind, 'permission');
  assert.equal(card.state, 'pending');
  assert.deepEqual(card.actions.map(a => a.decision), ['allow', 'deny', 'allow_all']);

  // A newer prompt in the same session supersedes the old one.
  prompt();
  await tick();
  const second = hub.store.page(1).at(-1);
  assert.equal(JSON.parse(hub.store.message(first.id).card).state, 'expired');
  assert.throws(() => gw.decidePermission(first.id, 'allow'), /过期/);
  assert.equal(bot.of('card_action').length, 0);

  const out = gw.decidePermission(second.id, 'allow_all');
  assert.equal(JSON.parse(out.card).state, 'allowed_all');
  assert.deepEqual(bot.of('card_action'), [{ type: 'card_action', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', action: 'perm:allow_all' }]);
  // Repeated click: rejected, nothing more sent to the bot.
  assert.throws(() => gw.decidePermission(second.id, 'deny'), /已经处理/);
  assert.equal(bot.of('card_action').length, 1);
  // Not a permission prompt / unknown decision.
  const plain = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: 'hi' }).message;
  assert.throws(() => gw.decidePermission(plain.id, 'allow'), /不是权限请求/);
  assert.throws(() => gw.decidePermission(second.id, 'sudo'), /unknown decision/);

  // Offline bot: the request stays pending and the click says why.
  prompt();
  await tick();
  const third = hub.store.page(1).at(-1);
  gw.bots.delete('dou');
  assert.throws(() => gw.decidePermission(third.id, 'allow'), /断线/);
  assert.equal(JSON.parse(hub.store.message(third.id).card).state, 'pending');
  // Reconnect = restarted cc-connect: its pending requests expire.
  const again = connect(gw, 'bot=dou&name=大豆包');
  assert.equal(again.of('register_ack')[0].ok, true);
  assert.equal(JSON.parse(hub.store.message(third.id).card).state, 'expired');
});

test('cloud-web #120: owner text reply takes the same decision path; bot text does not approve', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const bot = connect(gw, 'bot=dou&name=大豆包');
  const other = connect(gw, 'bot=ju&name=橘');
  bot.frame({ type: 'buttons', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', content: '权限请求', buttons: [[{ Text: '允许', Data: 'perm:allow' }, { Text: '拒绝', Data: 'perm:deny' }]] });
  await tick();
  const promptRow = hub.store.page(1).at(-1);
  // The prompt itself is not forwarded to other bots as chat.
  assert.equal(other.of('message').length, 0);
  // Another bot saying "允许" does not decide anything.
  other.frame({ type: 'reply', reply_ctx: 'room-1', content: '允许' });
  await tick(); await tick();
  assert.equal(JSON.parse(hub.store.message(promptRow.id).card).state, 'pending');
  const before = bot.of('message').length;
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '拒绝' });
  await tick(); await tick();
  const card = JSON.parse(hub.store.message(promptRow.id).card);
  assert.equal(card.state, 'denied');
  assert.equal(card.decided_by, 'text');
  assert.equal(bot.of('card_action').at(-1).action, 'perm:deny');
  // The answered bot gets the decision once (card_action), not the text too.
  assert.equal(bot.of('message').length, before);
});

test('cloud-web #120: textDecision mirrors the bridge vocabularies', async () => {
  const { textDecision } = await import('./cloudweb.mjs');
  assert.equal(textDecision('允许所有'), 'allow_all');
  assert.equal(textDecision('allow all please'), 'allow_all');
  assert.equal(textDecision('好的，允许'), 'allow');
  assert.equal(textDecision('拒绝'), 'deny');
  assert.equal(textDecision('禁止允许这种'), undefined);
  assert.equal(textDecision('看看日志'), undefined);
  // Same separators as bridge permissionTokenSeparator: quotes, brackets, @, ·.
  assert.equal(textDecision('“允许”'), 'allow');
  assert.equal(textDecision('【允许】'), 'allow');
  assert.equal(textDecision('(拒绝)'), 'deny');
  assert.equal(textDecision('「允许」'), undefined); // not a bridge separator either
  assert.equal(textDecision("'allow'"), 'allow');
  assert.equal(textDecision('＠橘·允许所有'), 'allow_all');
});

test('cloud-web #120: owner text with several bots pending — no @ answers all, @ answers only that bot', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const dou = connect(gw, 'bot=dou&name=大豆包');
  const ju = connect(gw, 'bot=ju&name=橘');
  const ask = async b => {
    b.frame({ type: 'buttons', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', content: '权限请求', buttons: [[{ Text: '允许', Data: 'perm:allow' }, { Text: '拒绝', Data: 'perm:deny' }]] });
    await tick();
    return hub.store.page(1).at(-1).id;
  };
  const state = id => JSON.parse(hub.store.message(id).card).state;
  // No @: every bot's cc-connect would act on the word, so every card takes the decision.
  let a = await ask(dou), b = await ask(ju);
  const msgsBefore = [dou.of('message').length, ju.of('message').length];
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '“允许”' });
  await tick(); await tick();
  assert.equal(state(a), 'allowed');
  assert.equal(state(b), 'allowed');
  assert.equal(dou.of('card_action').at(-1).action, 'perm:allow');
  assert.equal(ju.of('card_action').at(-1).action, 'perm:allow');
  assert.deepEqual([dou.of('message').length, ju.of('message').length], msgsBefore);
  // @ one bot: only its card is decided; the other is not sent the text and stays pending.
  a = await ask(dou); b = await ask(ju);
  const douActs = dou.of('card_action').length, juMsgs = ju.of('message').length;
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@橘 拒绝' });
  await tick(); await tick();
  assert.equal(state(b), 'denied');
  assert.equal(ju.of('card_action').at(-1).action, 'perm:deny');
  assert.equal(state(a), 'pending');
  assert.equal(dou.of('card_action').length, douActs);
  assert.equal(dou.of('message').filter(m => /拒绝/.test(m.content)).length, 0);
  assert.equal(ju.of('message').length, juMsgs);
  // Text that is not a decision still reaches everyone.
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '等一下' });
  await tick(); await tick();
  assert.equal(dou.of('message').at(-1).content, '等一下');
  assert.equal(state(a), 'pending');
});

// Issue #122: a channel message may reply to one earlier message.
test('reply: the quote is stored and served; a deleted original degrades without leaking it', async () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'other');
  const events = [];
  hub.subscribe(e => events.push(e));
  const { message: orig } = hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '一'.repeat(50) });
  const { message: reply } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '收到', replyTo: orig.id });
  assert.equal(reply.reply_to, orig.id);
  const { publicMessage } = await import('./store.mjs');
  const pub = publicMessage(reply, hub.store);
  assert.deepEqual(pub.reply_to, { id: orig.id, author_kind: 'role', author: 'ju', name: '橘', text: '一'.repeat(40) + '…' });
  assert.deepEqual(events.at(-1).message.reply_to, pub.reply_to, 'the live event carries the quote');
  assert.equal(publicMessage(orig, hub.store).reply_to, undefined, 'a plain message has no quote');
  assert.throws(() => hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: 'x', replyTo: 999 }), { code: 'reply-missing' });
  const { message: elsewhere } = hub.post(2, { authorKind: 'user', author: 'owner', name: '我', text: '别处' });
  assert.throws(() => hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: 'x', replyTo: elsewhere.id }), { code: 'reply-missing' }, 'only the same room');
  hub.remove(orig.id, 'role', 'ju');
  const gone = publicMessage(hub.store.message(reply.id), hub.store);
  assert.deepEqual(gone.reply_to, { id: orig.id, deleted: true });
  assert.doesNotMatch(JSON.stringify(gone), /一一/, 'deleted text never leaks');
});

test('reply: a v6 database gains reply_to and keeps its messages', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v6.sqlite3');
  const s = new Store(path);
  s.ensureRoom(1, 'general');
  s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '老消息' });
  s.db.exec('ALTER TABLE messages DROP COLUMN reply_to; PRAGMA user_version = 6');
  s.close();
  const up = new Store(path);
  assert.equal(up.db.prepare('PRAGMA user_version').get().user_version, 11);
  const old = up.page(1, undefined, 1)[0];
  assert.equal(old.text, '老消息');
  assert.equal(old.reply_to, null);
  assert.equal(up.append(1, { authorKind: 'user', author: 'owner', name: '我', text: '回', replyTo: old.id }).message.reply_to, old.id);
  up.close();
});

test('reply routing (reply_routing.go): the replied-to bot is called, others are not woken; deleted names nobody', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');
  const { message: juSaid } = hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '日志看完了，一切正常' });
  await settle();
  const whaleBefore = whale.of('message').length;

  // Reply to 橘 with no @: only 橘 takes it, with the Discord-style quote prefix.
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '再看一遍', replyTo: juSaid.id });
  await settle();
  const toJu = ju.of('message').at(-1);
  assert.equal(toJu.mentioned, true);
  assert.equal(toJu.content, '[回复 橘：日志看完了，一切正常] 再看一遍');
  assert.equal(whale.of('message').length, whaleBefore, 'another bot is not woken');
  assert.equal(hub.store.openJobs().length, 0, 'no DSH job either');

  // Reply to 橘 while @-ing DeepSeek: both are called, 鲸鱼娘 still is not.
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 你也看看', replyTo: juSaid.id });
  await settle();
  assert.equal(ju.of('message').at(-1).mentioned, true);
  assert.equal(whale.of('message').length, whaleBefore);
  assert.equal(dsh.made.length, 1);
  const prompt = dsh.sessions.get(dsh.made[0]).prompts[0].content[0].text;
  assert.match(prompt, /【我】\[回复 橘：日志看完了，一切正常\] @DeepSeek 你也看看$/);

  // Original deleted: a reply without @ establishes no recipient, and the bot sees no original text.
  const { message: gone } = hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '机密内容' });
  await settle();
  const { message: late } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '占位' });
  hub.store.db.prepare('UPDATE messages SET reply_to = ? WHERE id = ?').run(gone.id, late.id);
  hub.remove(gone.id, 'role', 'ju');
  const juBefore = ju.of('message').length;
  const whaleNow = whale.of('message').length;
  gw.onNew(hub.store.message(late.id));
  assert.equal(ju.of('message').length, juBefore, 'no guessed recipient');
  assert.equal(whale.of('message').length, whaleNow);
  assert.equal(hub.replyRoute(hub.store.message(late.id)).size, 0);
  const { quotePrefix } = await import('./store.mjs');
  assert.equal(quotePrefix(hub.store.quote(hub.store.message(late.id))), '[回复 原消息已删除] ');
});

// ---- #139 team mode B: tasks ----

/** Hub + tasks on a hand-driven clock; the timer is captured instead of scheduled. */
function makeTasks() {
  const hub = makeHub();
  const clock = { t: 1000, timer: undefined };
  const tasks = new Tasks(hub, {
    now: () => clock.t,
    setTimer: (fn, ms) => { clock.timer = { fn, ms }; return clock.timer; },
    clearTimer: (h) => { if (clock.timer === h) clock.timer = undefined; },
  });
  hub.setMember({ id: 'lead', name: '橘', kind: 'bot', online: true });
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  return { hub, tasks, clock };
}
const records = hub => hub.store.page(1, undefined, 200).filter(m => m.author_kind === 'system');

test('tasks: rooms snapshots track dispatch, return, rework and acceptance without reload', () => {
  const { hub, tasks } = makeTasks();
  const ws = hub.store.createWorkspace(1);
  const events = [];
  hub.subscribe(e => { if (e.type === 'rooms') events.push(e.rooms); });
  const counts = () => hub.store.roomsView().map(r => r.active);
  const latest = () => events.at(-1)?.map(r => r.active);
  assert.deepEqual(counts(), [0, 0]);
  const task = tasks.assign({ roomId: ws.id, title: 'live counts', owner: 'ds', actor: 'lead' });
  assert.deepEqual(counts(), [0, 1]);
  assert.deepEqual(latest(), [0, 1]);
  tasks.stance(task.id, { actor: 'ds', stance: '接' });
  assert.deepEqual(latest(), [0, 1]);
  const { message } = hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: 'result' });
  tasks.handBack(task.id, { actor: 'ds', messageId: message.id });
  assert.deepEqual(latest(), [0, 0]);
  tasks.review(task.id, { actor: 'lead', verdict: 'rework', note: '再补一段' });
  assert.deepEqual(latest(), [0, 1]);
  tasks.handBack(task.id, { actor: 'ds', messageId: message.id });
  tasks.review(task.id, { actor: 'lead', verdict: 'done' });
  assert.deepEqual(counts(), [0, 0]);
  assert.deepEqual(latest(), [0, 0]);
  assert.equal(events.length, 6);
  tasks.close(); hub.store.close();
});

test('tasks: dispatch → 接 → hand back → done, each step leaves one task record', () => {
  const { hub, tasks, clock } = makeTasks();
  const t = tasks.assign({ roomId: 1, title: '写登录页', owner: 'ds', actor: 'lead' });
  assert.equal(t.status, 'assigned');
  assert.equal(t.next_check_at, 1000 + CHECK_AFTER_S, 'default check time is 10 minutes after dispatch');
  assert.equal(clock.timer.ms, CHECK_AFTER_S * 1000);
  assert.equal(t.assign_msg_id, records(hub)[0].id, 'without a dispatch message the record is the jump target');
  assert.equal(tasks.stance(t.id, { actor: 'ds', stance: '接' }).status, 'accepted');
  clock.t += 120;
  const { message: delivery } = hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '登录页好了' });
  assert.throws(() => tasks.handBack(t.id, { actor: 'lead', messageId: delivery.id }), /only DeepSeek/);
  const back = tasks.handBack(t.id, { actor: 'ds', messageId: delivery.id });
  assert.equal(back.status, 'returned');
  assert.equal(back.result_msg_id, delivery.id);
  assert.equal(back.next_check_at, null);
  assert.throws(() => tasks.review(t.id, { actor: 'ds', verdict: 'done' }), /only 橘/);
  assert.equal(tasks.review(t.id, { actor: 'lead', verdict: 'done' }).status, 'done');
  const r = records(hub);
  assert.equal(r.length, 4);
  assert.deepEqual(r.map(m => JSON.parse(m.card).event), ['assign', 'stance', 'return', 'done']);
  assert.match(r[0].text, /派活 #1「写登录页」→ DeepSeek（橘 派）/);
  assert.match(r[2].text, /交回，用时 2 分钟/);
  assert.equal(r.every(m => !m.text.includes('@')), true, 'records @ nobody');
  assert.throws(() => tasks.review(t.id, { actor: 'lead', verdict: 'done' }), /nothing to review/);
});

test('tasks: 问 keeps the timer; 退 and 升 hand the turn to the lead; rework starts a new round', () => {
  const { tasks, clock } = makeTasks();
  const a = tasks.assign({ roomId: 1, title: 'a', owner: 'ds', actor: 'lead' });
  const asked = tasks.stance(a.id, { actor: 'ds', stance: '问', note: '要不要兼容旧版？' });
  assert.equal(asked.status, 'asked');
  assert.equal(asked.note, '要不要兼容旧版？');
  assert.equal(asked.next_check_at, a.next_check_at);
  const b = tasks.assign({ roomId: 1, title: 'b', owner: 'ds', actor: 'lead', force: true });
  assert.equal(tasks.stance(b.id, { actor: 'ds', stance: 'decline' }).status, 'declined');
  assert.equal(tasks.task(b.id).next_check_at, null);
  assert.throws(() => tasks.stance(b.id, { actor: 'ds', stance: '接' }), /not waiting/);
  const c = tasks.assign({ roomId: 1, title: 'c', owner: 'ds', actor: 'lead', force: true });
  assert.equal(tasks.stance(c.id, { actor: 'ds', stance: '升' }).status, 'escalated');
  assert.equal(tasks.task(c.id).next_check_at, null);
  clock.t += 50;
  const again = tasks.review(c.id, { actor: 'lead', verdict: 'rework', note: '拆小一点再做' });
  assert.equal(again.status, 'rework');
  assert.equal(again.next_check_at, 1050 + CHECK_AFTER_S);
  assert.throws(() => tasks.stance(a.id, { actor: 'lead', stance: '接' }), /only DeepSeek/);
  assert.throws(() => tasks.stance(a.id, { actor: 'ds', stance: '好' }), /接 问 退 升/);
});

test('tasks: a member reply whose first line is 【接】/【问】/【退】/【升】 sets its task status', async () => {
  const { hub, tasks } = makeTasks();
  // A bridge bot: a DSH member's 【接】 is also its hand-back (see the one-message 【接】 test).
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'bot', online: true });
  const a = tasks.assign({ roomId: 1, title: 'a', owner: 'ds', actor: 'lead' });
  const b = tasks.assign({ roomId: 1, title: 'b', owner: 'ds', actor: 'lead', force: true });
  hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '【接】马上做\n细节……' });
  await tick();
  assert.equal(tasks.task(b.id).status, 'accepted', 'no #id: the newest open task of that member in the room');
  assert.equal(tasks.task(b.id).note, '马上做');
  hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: `【升】#${a.id} 需要拍板` });
  await tick();
  assert.equal(tasks.task(a.id).status, 'escalated');
  hub.post(1, { authorKind: 'role', author: 'lead', name: '橘', text: `【退】#${b.id}` });
  hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '正文里提到【退】不算' });
  await tick();
  assert.equal(tasks.task(b.id).status, 'accepted', 'only the owner, only the first line');
});

test('tasks: one reminder @s the owner at the check time and wakes only it; hand-back cancels it', async () => {
  const { hub, tasks, clock } = makeTasks();
  const woken = [];
  tasks.onWake((id, msg) => woken.push([id, msg.id]));
  const late = tasks.assign({ roomId: 1, title: '迟交的', owner: 'ds', actor: 'lead' });
  const onTime = tasks.assign({ roomId: 1, title: '准时的', owner: 'ds', actor: 'lead', force: true });
  clock.t += 60;
  const { message: d } = hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '交付' });
  tasks.handBack(onTime.id, { actor: 'ds', messageId: d.id });
  clock.t = late.next_check_at - 1;
  tasks.tick();
  assert.equal(woken.length, 0, 'not before the check time');
  clock.t = late.next_check_at + 1;
  clock.timer.fn();
  const reminders = hub.store.page(1, undefined, 200).filter(m => m.name === '任务提醒');
  assert.equal(reminders.length, 1);
  assert.match(reminders[0].text, /^@DeepSeek 任务 #1「迟交的」/);
  assert.deepEqual(woken, [['ds', reminders[0].id]]);
  assert.equal(tasks.task(late.id).next_check_at, null);
  clock.t += 3600;
  tasks.tick();
  assert.equal(hub.store.page(1, undefined, 200).filter(m => m.name === '任务提醒').length, 1, 'only once');
  assert.equal(tasks.timer, undefined, 'nothing left to check');
});

test('tasks: without #id a stance only answers a dispatch not yet answered (PR #136 review 1)', async () => {
  const { hub, tasks } = makeTasks();
  // A bridge bot: a DSH member's 【接】 is also its hand-back (see the one-message 【接】 test).
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'bot', online: true });
  const t = tasks.assign({ roomId: 1, title: '写登录页', owner: 'ds', actor: 'lead' });
  hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '【接】好的' });
  await tick();
  assert.equal(tasks.task(t.id).status, 'accepted');
  const check = tasks.task(t.id).next_check_at;
  // A reply about something else, opened with the team's stance line as usual.
  hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '【退】这个翻译我不擅长，找鲸鱼娘' });
  await tick();
  assert.equal(tasks.task(t.id).status, 'accepted', 'an answered task is not changed without #id');
  assert.equal(tasks.task(t.id).next_check_at, check, 'its reminder stays');
  hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: `【退】#${t.id} 做不了` });
  await tick();
  assert.equal(tasks.task(t.id).status, 'declined', 'with #id it applies');
});

test('tasks: an offline owner gets its reminder once when it comes online (PR #136 review 2)', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const clock = { t: 1000, timer: undefined };
  const tasks = new Tasks(hub, { now: () => clock.t, setTimer: (fn) => (clock.timer = { fn }), clearTimer() {} });
  tasks.onWake((id, msg) => gw.nudge(id, msg));
  hub.setMember({ id: 'lead', name: '橘', kind: 'bot', online: true });
  hub.setMember({ id: 'ju', name: '鲸鱼', kind: 'bot', online: false });
  const t = tasks.assign({ roomId: 1, title: '润色', owner: 'ju', actor: 'lead' });
  clock.t += CHECK_AFTER_S + 1;
  clock.timer.fn();
  assert.equal(tasks.task(t.id).next_check_at, null);
  assert.notEqual(tasks.task(t.id).remind_msg_id, null, 'the bot is offline: the reminder stays pending');
  const ju = connect(gw, 'bot=ju&name=鲸鱼');
  const got = ju.of('message');
  assert.equal(got.length, 1, 'delivered on connect');
  assert.match(got[0].content, /任务 #1「润色」到了检查时间/);
  assert.equal(got[0].mentioned, true);
  hub.setOnline('lead', false); hub.setOnline('lead', true);
  const again = connect(gw, 'bot=ju&name=鲸鱼');
  assert.equal(ju.of('message').length + again.of('message').length, 1, 'a delivered reminder is never sent again');
  assert.equal(hub.store.page(1, undefined, 200).filter(m => m.name === '任务提醒').length, 1);
});

test('tasks: a reminder due during a restart is delivered after the bot reconnects (PR #136 review 2)', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'tasks-restart-'));
  try {
    const file = join(dir, 'collab.sqlite3');
    const s1 = new Store(file); s1.ensureRoom(1, 'general');
    const hub1 = new Hub(s1, quiet);
    hub1.setMember({ id: 'lead', name: '橘', kind: 'bot', online: true });
    hub1.setMember({ id: 'ju', name: '鲸鱼', kind: 'bot', online: true });
    const before = new Tasks(hub1, { now: () => 1000, setTimer: () => ({}), clearTimer() {} });
    const t = before.assign({ roomId: 1, title: '润色', owner: 'ju', actor: 'lead' });
    before.close(); s1.db.close();
    // Restart after the check time; the timer fires before cc-connect reconnects.
    const s2 = new Store(file);
    const hub2 = new Hub(s2, quiet);
    const gw = new CloudWebGateway(hub2, { token: 't', logger: quiet });
    const clock = { t: 1000 + CHECK_AFTER_S + 5, timer: undefined };
    const after = new Tasks(hub2, { now: () => clock.t, setTimer: (fn, ms) => (clock.timer = { fn, ms }), clearTimer() {}, start: false });
    after.onWake((id, msg) => gw.nudge(id, msg));
    assert.equal(clock.timer, undefined, 'start: false arms nothing');
    after.start();
    assert.equal(clock.timer.ms, 0);
    clock.timer.fn();
    assert.equal(after.task(t.id).next_check_at, null);
    const ju = connect(gw, 'bot=ju&name=鲸鱼');
    assert.equal(ju.of('message').length, 1, 'not lost: delivered once on reconnect');
    connect(gw, 'bot=ju&name=鲸鱼');
    assert.equal(hub2.store.page(1, undefined, 200).filter(m => m.name === '任务提醒').length, 1);
    after.close(); s2.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tasks: the reminder starts a DSH owner turn with the reminder in its prompt; records start nobody', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  const clock = { t: 1000 };
  const tasks = new Tasks(hub, { now: () => clock.t, setTimer: () => ({}), clearTimer() {} });
  // Same wiring as plugin.mjs.
  tasks.onWake((id, msg) => members.nudge(id, msg) || gw.nudge(id, msg));
  const t = tasks.assign({ roomId: 1, title: '跑测试', owner: 'ds', actor: 'ju' });
  tasks.stance(t.id, { actor: 'ds', stance: '接' });
  const t2 = tasks.assign({ roomId: 1, title: '看日志', owner: 'ju', actor: 'owner' });
  await settle();
  assert.equal(hub.store.openJobs().length, 0, 'task records start no DSH job');
  assert.equal(dsh.made.length, 0);
  assert.equal(ju.of('message').length, 0, 'task records are not forwarded to cloud-web bots');
  clock.t += CHECK_AFTER_S + 1;
  tasks.tick();
  await settle();
  assert.equal(dsh.made.length, 1, 'the DSH owner is woken by its reminder');
  const prompt = dsh.sessions.get(dsh.made[0]).prompts[0].content[0].text;
  assert.match(prompt, /【任务提醒】@DeepSeek 任务 #1「跑测试」到了检查时间还没交回/);
  const toJu = ju.of('message');
  assert.equal(toJu.length, 1, 'the cloud-web owner gets exactly its own reminder');
  assert.equal(toJu[0].mentioned, true);
  assert.match(toJu[0].content, new RegExp(`任务 #${t2.id}「看日志」`));
});

test('tasks: workspace records also go to its chat channel; the board and active count span both', () => {
  const { hub, tasks } = makeTasks();
  // Team mode A (#134) adds rooms.kind/parent_id. After the merge they exist already;
  // add them only when this checkout predates A, so the test works before and after.
  if (!hub.store.db.prepare('PRAGMA table_info(rooms)').all().some(c => c.name === 'kind')) {
    hub.store.db.exec("ALTER TABLE rooms ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'; ALTER TABLE rooms ADD COLUMN parent_id INTEGER");
  }
  hub.store.db.exec("INSERT INTO rooms (id, name, kind, parent_id) VALUES (2, '工作区1', 'workspace', 1), (3, 'other', 'chat', NULL)");
  hub.store.q.room = hub.store.db.prepare('SELECT id, name, kind, parent_id FROM rooms WHERE id = ?');
  const tree = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  const inWs = tree.assign({ roomId: 2, title: '在工作区', owner: 'ds', actor: 'lead' });
  tree.assign({ roomId: 1, title: '在聊天频道', owner: 'ds', actor: 'lead', force: true });
  tree.assign({ roomId: 3, title: '别的频道', owner: 'ds', actor: 'lead', force: true });
  const ws = hub.store.page(2, undefined, 50).filter(m => m.card);
  const chat = hub.store.page(1, undefined, 50).filter(m => m.card);
  assert.equal(ws.length, 1);
  assert.equal(chat.length, 2, 'the workspace dispatch is echoed to the chat channel');
  assert.equal(chat[0].text, ws[0].text);
  assert.deepEqual(tree.list(1).map(t => t.title), ['在聊天频道', '在工作区']);
  assert.deepEqual(tree.list(2).map(t => t.title), ['在聊天频道', '在工作区'], 'a workspace shows its chat channel board');
  assert.equal(tree.countActive(2), 1);
  const { message: d } = hub.post(2, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '好了' });
  tree.handBack(inWs.id, { actor: 'ds', messageId: d.id });
  assert.equal(tree.countActive(2), 0, 'returned is no longer in progress');
  tree.close(); tasks.close();
});

test('tasks: the tasks table is ensured idempotently and survives reopen', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'tasks.sqlite3');
  const s = new Store(path);
  s.ensureRoom(1, 'general');
  s.db.exec("INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at) VALUES (1, 'kept', 'ds', 'owner', 'assigned', 1, 1)");
  s.db.exec('ALTER TABLE tasks DROP COLUMN note; PRAGMA user_version = 8');
  s.close();
  const again = new Store(path);
  again.ensureTasks();
  const cols = again.db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name);
  assert.equal(cols.includes('note'), true, 'a missing column is added back');
  assert.equal(again.db.prepare('SELECT title FROM tasks').get().title, 'kept');
  assert.equal(again.db.prepare('PRAGMA user_version').get().user_version, 11);
  again.close();
});

test('tasks API: owner acts as owner, bots name themselves with the bot token, others get 401', async () => {
  const { hub, tasks } = makeTasks();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const call = async (method, path, body, { human = false, token } = {}) => {
    const req = new EventEmitter();
    req.method = method; req.url = path; req.headers = token ? { authorization: `Bearer ${token}` } : {};
    const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
    const p = tasksRoute(req, res, new URL(path, 'http://x'), { tasks, gateway: gw, owner: () => human });
    if (body !== undefined) { req.emit('data', Buffer.from(JSON.stringify(body))); }
    req.emit('end');
    await p;
    return { status: res.status, json: JSON.parse(res.body) };
  };
  assert.equal(tasksRoute({ method: 'GET', headers: {} }, {}, new URL('http://x/collab/api/state'), { tasks, gateway: gw, owner: () => true }), undefined);
  assert.equal((await call('POST', '/collab/api/rooms/1/tasks', { title: 'x', owner: 'ds', actor: 'lead' })).status, 401);
  const made = await call('POST', '/collab/api/rooms/1/tasks', { title: '写文档', owner: 'ds', actor: 'lead', ref: '无（新建）' }, { token: 't' });
  assert.equal(made.status, 200);
  assert.equal(made.json.task.created_by, 'lead');
  const id = made.json.task.id;
  assert.equal((await call('POST', `/collab/api/tasks/${id}/stance`, { stance: '接', actor: 'lead' }, { token: 't' })).status, 403);
  assert.equal((await call('POST', `/collab/api/tasks/${id}/stance`, { stance: '接', actor: 'ds' }, { token: 't' })).json.task.status, 'accepted');
  assert.equal((await call('POST', `/collab/api/tasks/${id}/return`, { actor: 'ds' }, { token: 't' })).status, 400);
  assert.equal((await call('POST', `/collab/api/tasks/${id}/review`, { verdict: 'done' }, { human: true })).status, 409);
  const board = await call('GET', '/collab/api/rooms/1/tasks', undefined, { human: true });
  assert.deepEqual(board.json.tasks.map(t => [t.title, t.status, t.owner_name]), [['写文档', 'accepted', 'DeepSeek']]);
  assert.equal((await call('GET', '/collab/api/tasks/99', undefined, { human: true })).status, 404);
  assert.equal((await call('POST', '/collab/api/rooms/1/tasks', { title: 'y', owner: 'nobody' }, { human: true })).status, 404);
});

test('tasks identity: the bot token cannot impersonate the owner or review; a socket frame acts as its own bot', async () => {
  const { hub, tasks } = makeTasks();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  gw.tasks = tasks;
  const call = async (path, body) => {
    const req = new EventEmitter();
    req.method = 'POST'; req.url = path; req.headers = { authorization: 'Bearer t' };
    const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
    const p = tasksRoute(req, res, new URL(path, 'http://x'), { tasks, gateway: gw, owner: () => false });
    req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end');
    await p;
    return { status: res.status, json: JSON.parse(res.body) };
  };
  // The shared token may not claim to be the human owner, nobody, or anyone unknown.
  for (const actor of ['owner', undefined, 'ghost']) {
    assert.equal((await call('/collab/api/rooms/1/tasks', { title: 'x', owner: 'ds', actor })).status, 403, String(actor));
  }
  const t = tasks.assign({ roomId: 1, title: '写测试', owner: 'ds', actor: 'lead' });
  const delivery = hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '好了' }).message;
  tasks.handBack(t.id, { actor: 'ds', messageId: delivery.id });
  // Self-reporting as the dispatcher is not enough to accept.
  const forged = await call(`/collab/api/tasks/${t.id}/review`, { verdict: 'done', actor: 'lead' });
  assert.equal(forged.status, 403);
  assert.equal(tasks.task(t.id).status, 'returned');
  // Over its own socket, another bot is still not the dispatcher ...
  const whale = connect(gw, 'bot=whale&name=鲸鱼娘');
  whale.frame({ type: 'task', action: 'review', task_id: t.id, verdict: 'done', ref: 'r1' });
  await new Promise(r => setImmediate(r));
  assert.equal(whale.of('task_ack')[0].ok, false);
  assert.equal(whale.of('task_ack')[0].code, 'forbidden');
  // ... and the dispatcher's own socket accepts, whatever actor the frame claims.
  const lead = connect(gw, 'bot=lead&name=橘');
  lead.frame({ type: 'task', action: 'review', task_id: t.id, verdict: 'done', actor: 'owner', ref: 'r2' });
  await new Promise(r => setImmediate(r));
  const ack = lead.of('task_ack')[0];
  assert.equal(ack.ref, 'r2');
  assert.equal(ack.ok, true);
  assert.equal(ack.task.status, 'done');
  // A frame dispatch is recorded as the sending bot.
  lead.frame({ type: 'task', action: 'assign', reply_ctx: 'room-1', title: '再写一个', owner: 'ds', actor: 'whale', ref: 'r3', task_ref: '无（新建）' });
  await new Promise(r => setImmediate(r));
  assert.equal(lead.of('task_ack')[1].task.created_by, 'lead');
});

// #139 team mode A: chat channels own workspaces 工作区1..n.
const plain = v => JSON.parse(JSON.stringify(v));
test('store: a v6 database gains kind/parent_id; opening it creates no workspace', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'v6.sqlite3');
  const old = new Store(path);
  old.ensureRoom(1, 'general');
  old.ensureRoom(2, 'dev');
  old.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'kept' });
  old.db.exec("DELETE FROM rooms WHERE kind = 'workspace'; ALTER TABLE rooms DROP COLUMN parent_id; ALTER TABLE rooms DROP COLUMN kind; PRAGMA user_version = 6");
  old.close();
  const s = new Store(path);
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 11);
  assert.deepEqual(plain(s.rooms()), [
    { id: 1, name: 'general', kind: 'chat', parent_id: null },
    { id: 2, name: 'dev', kind: 'chat', parent_id: null },
  ], 'no workspace is backfilled on open');
  assert.equal(s.page(1, undefined, 1)[0].text, 'kept');
  s.close();
  // Columns already present (e.g. another branch migrated first): reopening adds nothing twice.
  const again = new Store(path);
  again.db.exec('PRAGMA user_version = 6');
  again.close();
  const third = new Store(path);
  assert.equal(third.rooms().length, 2, 'still no workspace after reopening');
  third.close();
});

test('store: a configured chat channel gets no workspace until the first createWorkspace', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  assert.deepEqual(s.rooms().map(r => r.kind), ['chat'], 'startup creates no workspace');
  s.db.prepare("INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at) VALUES (1, 'active task', 'ds', 'lead', 'assigned', 1, 1)").run();
  assert.deepEqual(s.roomsView().map(r => r.active), [1]);
  assert.deepEqual(plain(s.createWorkspace(1)), { id: 1000000, name: '工作区1', kind: 'workspace', parent_id: 1 });
  assert.equal(s.createWorkspace(1).name, '工作区2');
  assert.deepEqual(s.roomsView().map(r => r.active), [1, 0, 0]);
});

test('store: default config, then {id:2} added — starts, workspace ids stay out of the config range', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'collab.sqlite3');
  const start = config => { // what plugin.apply does on startup
    const s = new Store(path);
    for (const r of resolveConfig({ dataDir: path, workspacePath: path, ...config }).rooms) s.ensureRoom(r.id, r.name);
    return s;
  };
  const first = start({}); // default config: one chat channel { id: 1, name: 'general' }
  assert.equal(first.rooms().some(r => r.kind === 'workspace'), false, 'startup creates no workspace');
  const ws = first.createWorkspace(1); // what the first POST .../workspaces does
  assert.deepEqual([ws.name, ws.parent_id], ['工作区1', 1]);
  assert.ok(ws.id >= 1000000, 'workspace ids start at 1000000');
  const key = roomKey(ws.id);
  const msg = first.append(ws.id, { authorKind: 'user', author: 'owner', name: '我', text: '在工作区' }).message;
  first.bind('m1', ws.id, 'sess-ws');
  first.addJob('m1', ws.id, msg.id);
  first.close();
  // A chat channel added to the config later takes its own small id; the workspace keeps its id.
  const second = start({ rooms: [{ id: 1, name: 'general' }, { id: 2, name: 'dev' }] });
  assert.deepEqual(plain(second.room(2)), { id: 2, name: 'dev', kind: 'chat', parent_id: null });
  assert.deepEqual(plain(second.room(ws.id)), { id: ws.id, name: '工作区1', kind: 'workspace', parent_id: 1 });
  assert.equal(second.message(msg.id).room_id, ws.id, 'the workspace keeps its messages');
  assert.equal(second.binding('m1', ws.id).session_id, 'sess-ws');
  assert.equal(second.job(1).room_id, ws.id);
  assert.equal(roomKey(second.rooms().find(r => r.kind === 'workspace').id), key, 'bot session key room-<id> is unchanged');
  assert.equal(second.page(2, undefined, 10).length, 0, 'the configured channel starts empty');
  // A config id that is inside the workspace range is refused instead of moving the workspace.
  assert.throws(() => second.ensureRoom(ws.id, 'clash'), e => e.code === 'workspace-id-conflict');
  second.close();
});

test('store: an unreleased dev database moves old small-id workspaces into the workspace range', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'collab.sqlite3');
  const old = new Store(path);
  old.ensureRoom(1, 'general');
  // Shape written by the previous PR revision: 工作区1 shares the config sequence at id 2.
  old.db.exec("INSERT INTO rooms (id, name, kind, parent_id) VALUES (2, '工作区1', 'workspace', 1)");
  const msg = old.append(2, { authorKind: 'user', author: 'owner', name: '我', text: '在工作区' }).message;
  old.bind('m1', 2, 'sess-ws');
  old.addJob('m1', 2, msg.id);
  old.close();
  const s = new Store(path);
  assert.deepEqual(plain(s.rooms()), [
    { id: 1, name: 'general', kind: 'chat', parent_id: null },
    { id: 1000000, name: '工作区1', kind: 'workspace', parent_id: 1 },
  ]);
  assert.equal(s.message(msg.id).room_id, 1000000);
  assert.equal(s.binding('m1', 1000000).session_id, 'sess-ws');
  assert.equal(s.job(1).room_id, 1000000);
  s.close();
});

test('store: a v8 database missing reply_to (#133 shipped after) gains it on open', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'collab.sqlite3');
  const s = new Store(path);
  s.ensureRoom(1, 'general');
  s.append(1, { authorKind: 'user', author: 'owner', name: '我', text: 'old' });
  s.db.exec('ALTER TABLE messages DROP COLUMN reply_to');
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 11);
  s.close();
  const up = new Store(path);
  assert.ok(up.db.prepare('PRAGMA table_info(messages)').all().some(c => c.name === 'reply_to'));
  assert.equal(up.db.prepare('PRAGMA user_version').get().user_version, 11);
  assert.equal(up.page(1, undefined, 1)[0].text, 'old');
  up.close();
});

test('store: creating a chat channel creates no workspace; the first createWorkspace makes 工作区1, then 工作区2', () => {
  const s = new Store(':memory:');
  const room = s.createRoom('ops');
  assert.deepEqual(plain(room), { id: 1, name: 'ops', kind: 'chat', parent_id: null });
  assert.equal(s.rooms().some(r => r.kind === 'workspace'), false, 'a new chat channel starts with no workspace');
  assert.equal(s.createWorkspace(1).name, '工作区1');
  assert.equal(s.createWorkspace(1).name, '工作区2');
  // Called on a workspace, the new one is a sibling under the same chat channel.
  const third = s.createWorkspace(1000000);
  assert.deepEqual([third.name, third.parent_id], ['工作区3', 1]);
  // Numbering follows the highest existing number, not the count.
  s.db.prepare('DELETE FROM rooms WHERE id = ?').run(third.id - 1);
  assert.equal(s.createWorkspace(1).name, '工作区4');
  const other = s.createRoom('other');
  assert.equal(other.kind, 'chat');
  // One shared pool per server: numbers continue across chat channels (1, 3, 4 exist).
  const pooled = s.createWorkspace(other.id);
  assert.deepEqual([pooled.name, pooled.parent_id], ['工作区5', other.id], 'numbering is unique across chat channels');
  assert.equal(s.createWorkspace(1).name, '工作区6');
  const names = s.rooms().filter(r => r.kind === 'workspace').map(r => r.name);
  assert.equal(new Set(names).size, names.length, `workspace names are globally unique: ${names}`);
  assert.throws(() => s.createWorkspace(99), e => e.code === 'room-missing');
});

test('store: opening renumbers the old per-chat duplicate 工作区n; ids and parents stay', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'collab.sqlite3');
  const old = new Store(path);
  old.ensureRoom(1, 'general');
  old.ensureRoom(2, 'dev');
  // Shape before the shared pool: each chat channel numbered its own 工作区1..n.
  old.db.exec(`INSERT INTO rooms (id, name, kind, parent_id) VALUES
    (1000000, '工作区1', 'workspace', 1), (1000001, '工作区2', 'workspace', 1),
    (1000002, '工作区1', 'workspace', 2), (1000003, '工作区2', 'workspace', 2)`);
  old.close();
  const s = new Store(path);
  const ws = () => plain(s.rooms().filter(r => r.kind === 'workspace')).map(r => [r.id, r.name, r.parent_id]);
  assert.deepEqual(ws(), [[1000000, '工作区1', 1], [1000001, '工作区2', 1], [1000002, '工作区3', 2], [1000003, '工作区4', 2]]);
  s.close();
  const again = new Store(path); // idempotent
  assert.deepEqual(plain(again.rooms().filter(r => r.kind === 'workspace')).map(r => r.name), ['工作区1', '工作区2', '工作区3', '工作区4']);
  assert.equal(again.createWorkspace(2).name, '工作区5');
  again.close();
});

test('store: a workspace belongs to one chat channel until it is released; then any chat channel may claim it', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  s.ensureRoom(2, 'dev');
  const w = s.createWorkspace(1);
  assert.equal(s.workspaceOwner(w.id), 1);
  // The owner may hand off again; another chat channel is refused.
  assert.equal(s.claimWorkspace(1, w.id).parent_id, 1);
  assert.throws(() => s.claimWorkspace(2, w.id), e => e.code === 'workspace-owned');
  assert.equal(s.room(w.id).parent_id, 1, 'a refused claim moves nothing');
  // From a workspace, the claim goes to its chat channel (still the owner here).
  const w2 = s.createWorkspace(1);
  assert.equal(s.claimWorkspace(w.id, w2.id).parent_id, 1);
  assert.throws(() => s.claimWorkspace(2, 1), e => e.code === 'not-workspace');
  assert.throws(() => s.claimWorkspace(2, 99), e => e.code === 'room-missing');
  // Released after its last task: free, and the next chat channel takes it.
  assert.equal(s.releaseWorkspace(w.id), true);
  assert.equal(s.workspaceOwner(w.id), null);
  assert.equal(s.releaseWorkspace(w.id), false, 'already free');
  assert.equal(s.claimWorkspace(2, w.id).parent_id, 2);
  assert.equal(s.workspaceOwner(w.id), 2);
});

test('store: createWorkspace takes the lowest free workspace of the shared pool before making 工作区n+1', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  s.ensureRoom(2, 'dev');
  const w1 = s.createWorkspace(1);
  const w2 = s.createWorkspace(1);
  assert.equal(s.createWorkspace(2).name, '工作区3', 'none free: a new one');
  s.releaseWorkspace(w2.id);
  s.releaseWorkspace(w1.id);
  const got = s.createWorkspace(2);
  assert.deepEqual([got.id, got.name, got.parent_id], [w1.id, '工作区1', 2]);
  assert.equal(s.workspaceOwner(w1.id), 2);
  assert.equal(s.createWorkspace(2).id, w2.id);
  assert.equal(s.createWorkspace(1).name, '工作区4');
});

test('store: a released workspace keeps its sessions until a new claim clears them; fresh ones start after its last message', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  const resets = [];
  s.onSessionsReset(id => resets.push(id));
  const w = s.createWorkspace(1);
  s.append(w.id, { authorKind: 'user', author: 'owner', name: 'owner', text: '旧活' });
  s.bind('ds', w.id, 'collab-old');
  const last = s.append(w.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '[report]\n旧活做完了' }).message;
  assert.equal(s.releaseWorkspace(w.id), true);
  assert.equal(s.binding('ds', w.id).session_id, 'collab-old', 'release alone keeps the session (#597 G35)');
  assert.equal(s.createWorkspace(1).id, w.id, 'a new handoff takes the free workspace');
  assert.equal(s.binding('ds', w.id), undefined, 'and the old session is unbound');
  assert.deepEqual(resets, [w.id], 'the listeners drop their per-conversation state');
  s.bind('ds', w.id, 'collab-new');
  assert.equal(s.binding('ds', w.id).context_cursor, last.id, 'the fresh session never reads the old task');
});

test('store G35: claimed back for a task of its last claim a workspace keeps its sessions; a claim by another chat channel in between clears them', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general');
  s.ensureRoom(2, 'dev');
  const w = s.createWorkspace(1);
  s.db.prepare(`INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at) VALUES (?, '活', 'ds', 'lead', 'returned', 1, 1)`).run(w.id);
  const taskId = s.db.prepare('SELECT MAX(id) AS id FROM tasks').get().id;
  s.bind('ds', w.id, 'collab-old');
  s.releaseWorkspace(w.id);
  s.claimWorkspace(1, w.id, { handoff: taskId });
  assert.equal(s.binding('ds', w.id).session_id, 'collab-old', 'rework goes on in the same session');
  s.releaseWorkspace(w.id);
  s.claimWorkspace(2, w.id);
  s.releaseWorkspace(w.id);
  assert.equal(s.binding('ds', w.id), undefined, 'another claim started fresh');
  s.bind('ds', w.id, 'collab-dev');
  s.claimWorkspace(1, w.id, { handoff: taskId });
  assert.equal(s.binding('ds', w.id), undefined, 'and the old task claimed back after it does not get dev\'s session');
});

test('G35: rework of a handed-back DSH task wakes its owner in the same workspace session, with no briefing needed', async () => {
  const { hub, tasks, woken, ws, assign, say } = g34Setup();
  const t = assign();
  hub.store.bind('fu', ws.id, 'collab-fu');
  say(ws.id, `【接】#${t.id}\n\n[report]\n做完了`);
  await settle();
  assert.equal(tasks.task(t.id).status, 'returned');
  assert.equal(hub.store.workspaceOwner(ws.id), null, 'the hand-back released the workspace');
  assert.equal(hub.store.binding('fu', ws.id).session_id, 'collab-fu', 'its session is kept');
  say(1, `【返工】#${t.id} 测试没跑`, 'zhu');
  await settle();
  assert.equal(tasks.task(t.id).status, 'rework');
  assert.equal(hub.store.binding('fu', ws.id).session_id, 'collab-fu', 'the rework goes on in the same session');
  const wake = woken.find(([id]) => id === 'fu');
  assert.ok(wake, 'the owner is woken');
  assert.equal(wake[1], ws.id, 'in its workspace');
  assert.doesNotMatch(wake[2], /新会话/, 'no briefing while the session is there');
});

test('G35: rework whose session a new claim cleared carries the original handoff and the last [report]', async () => {
  const { hub, tasks, woken, ws, say } = g34Setup();
  const handoff = hub.post(ws.id, { authorKind: 'system', author: 'system', name: '交接', text: '【交接】副：记账\n验收：pytest 全过，README 第一行写暗号' }).message;
  const t = tasks.assign({ roomId: ws.id, title: '记账', owner: 'fu', actor: 'zhu', messageId: handoff.id });
  tasks.q.setSource.run('workspace', t.id);
  hub.store.bind('fu', ws.id, 'collab-fu');
  say(ws.id, `【接】#${t.id}\n\n[report]\nledger 加了 add/list，12 个测试通过`);
  await settle();
  hub.store.resetSessions(ws.id); // as a new claim does
  say(1, `【返工】#${t.id} 缺 README`, 'zhu');
  await settle();
  const wake = woken.find(([id]) => id === 'fu');
  assert.ok(wake);
  assert.match(wake[2], /新会话/);
  assert.match(wake[2], /验收：pytest 全过，README 第一行写暗号/, 'the original handoff');
  assert.match(wake[2], /ledger 加了 add\/list，12 个测试通过/, 'the last [report]');
});

test('G35: a DSH task parked by the watch is woken in its kept session; answering resumes it there', async () => {
  const { hub, tasks, clock, woken, ws, assign } = g34Setup();
  const t = assign();
  hub.store.bind('fu', ws.id, 'collab-fu');
  clock.t = 1000 + CHECK_AFTER_S;
  tasks.tick();
  assert.ok(tasks.task(t.id).paused_at);
  assert.equal(hub.store.workspaceOwner(ws.id), null, 'the pause released the workspace');
  const wake = woken.find(([id]) => id === 'fu');
  assert.ok(wake && wake[1] === ws.id && !/新会话/.test(wake[2]), 'woken in the workspace, its session still there');
  assert.equal(hub.store.binding('fu', ws.id).session_id, 'collab-fu');
  hub.post(ws.id, { authorKind: 'role', author: 'fu', name: '副', text: `【问】#${t.id}\n做到第二步，卡在依赖` });
  await settle();
  assert.equal(tasks.task(t.id).paused_at, null, 'resumed');
  assert.equal(hub.store.workspaceOwner(ws.id), 1, 'claimed back for its chat channel');
  assert.equal(hub.store.binding('fu', ws.id).session_id, 'collab-fu', 'in the same session');
});

test('tasks: a workspace is released when its last task is handed back or done, and not while a new handoff waits', () => {
  const { hub } = makeTasks();
  const s = hub.store;
  s.ensureRoom(2, 'dev');
  const w = s.createWorkspace(1);
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  const released = [];
  tasks.onRelease(id => released.push(id));
  const msg = () => s.append(w.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '交回' }).message.id;
  const t1 = tasks.assign({ roomId: w.id, title: '一', owner: 'ds', actor: 'lead' });
  const t2 = tasks.assign({ roomId: w.id, title: '二', owner: 'ds', actor: 'lead', force: true });
  tasks.handBack(t1.id, { actor: 'ds', messageId: msg() });
  assert.equal(s.workspaceOwner(w.id), 1, 'one task still in work');
  assert.throws(() => s.claimWorkspace(2, w.id), e => e.code === 'workspace-owned');
  // general hands off again before the last task ends: that handoff keeps it.
  s.claimWorkspace(1, w.id);
  tasks.handBack(t2.id, { actor: 'ds', messageId: msg() });
  assert.equal(s.workspaceOwner(w.id), 1, 'a new handoff not worked on yet keeps the workspace');
  assert.deepEqual(released, []);
  const t3 = tasks.assign({ roomId: w.id, title: '三', owner: 'ds', actor: 'lead', force: true });
  tasks.review(t1.id, { actor: 'lead', verdict: 'done' });
  assert.equal(s.workspaceOwner(w.id), 1);
  tasks.handBack(t3.id, { actor: 'ds', messageId: msg() });
  assert.equal(s.workspaceOwner(w.id), null, 'all handed back: released');
  assert.deepEqual(released, [w.id]);
  assert.equal(s.claimWorkspace(2, w.id).parent_id, 2);
});

test('team exit: asks and reports go to the chat channel that owns the workspace; another channel waits for the release', async () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'dev');
  const ws = hub.store.createWorkspace(1); // created from general: general owns it
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  new TeamExit(hub);
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  gw.tasks = tasks;
  const ju = connect(gw, 'bot=ju&name=橘');
  // dev tries the same workspace (what core ClaimTeamWorkspace sends): refused.
  ju.frame({ type: 'team_workspace', ref_id: 'c1', op: 'claim', session_key: 'cloud_web:room-2', reply_ctx: 'room-2', workspace_id: roomKey(ws.id) });
  await tick();
  assert.deepEqual(ju.of('team_workspace_ack').at(-1), { type: 'team_workspace_ack', ref_id: 'c1', ok: false, error: 'workspace-owned' });
  ju.frame({ type: 'team_workspace', ref_id: 'l1', op: 'list', reply_ctx: 'room-2' });
  await tick();
  assert.deepEqual(ju.of('team_workspace_ack').at(-1).rooms.map(r => [r.name, r.owner]), [['工作区1', 'room-1']]);
  hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '[report]\n做完了' });
  await tick();
  assert.ok(hub.store.page(1, undefined, 10).some(m => m.author_kind === 'system' && /做完了/.test(m.text)), 'report reaches the owner');
  assert.equal(hub.store.page(2, undefined, 10).some(m => m.author_kind === 'system'), false, 'never the other chat channel');
  // A task in work keeps it: the bridge's release is refused.
  const t = tasks.assign({ roomId: ws.id, title: '活', owner: 'ds', actor: 'ju' });
  ju.frame({ type: 'team_workspace', ref_id: 'r1', op: 'release', reply_ctx: roomKey(ws.id) });
  await tick();
  assert.deepEqual(ju.of('team_workspace_ack').at(-1), { type: 'team_workspace_ack', ref_id: 'r1', ok: false, error: 'busy' });
  const back = hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '交回' }).message;
  tasks.handBack(t.id, { actor: 'ds', messageId: back.id });
  ju.frame({ type: 'team_workspace', ref_id: 'l2', op: 'list', reply_ctx: 'room-2' });
  await tick();
  assert.deepEqual(ju.of('team_workspace_ack').at(-1).rooms.map(r => [r.name, r.owner]), [['工作区1', '']], 'free after its last task');
  ju.frame({ type: 'team_workspace', ref_id: 'c2', op: 'claim', reply_ctx: 'room-2', workspace_id: roomKey(ws.id) });
  await tick();
  assert.equal(ju.of('team_workspace_ack').at(-1).ok, true);
  hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '[ask]\n要答案\n自验：无需\n类别：方向' });
  await tick();
  assert.ok(hub.store.page(2, undefined, 10).some(m => m.author_kind === 'system' && /要答案/.test(m.text)), 'ask reaches dev, the new owner');
  assert.equal(hub.store.page(1, undefined, 20).some(m => m.author_kind === 'system' && /要答案/.test(m.text)), false);
  // The bridge's release (lead session reset after its last task) frees it again.
  ju.frame({ type: 'team_workspace', ref_id: 'r2', op: 'release', reply_ctx: roomKey(ws.id) });
  await tick();
  assert.equal(ju.of('team_workspace_ack').at(-1).ok, true);
  assert.equal(hub.store.workspaceOwner(ws.id), null);
  ju.frame({ type: 'team_workspace', ref_id: 'c3', op: 'claim', reply_ctx: 'room-1', workspace_id: 'room-1' });
  await tick();
  assert.deepEqual(ju.of('team_workspace_ack').at(-1), { type: 'team_workspace_ack', ref_id: 'c3', ok: false, error: 'not-workspace' });
});

test('team workspace park: paused tasks stop counting, the workspace goes back to the pool and is reused before a new one', async () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'dev');
  const ws = hub.store.createWorkspace(1); // general owns 工作区1
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  gw.tasks = tasks;
  const ju = connect(gw, 'bot=ju&name=橘');
  const t1 = tasks.assign({ roomId: ws.id, title: '停在干净点的活', owner: 'ds', actor: 'ju' });
  tasks.stance(t1.id, { actor: 'ds', stance: 'ask', note: '等用户反馈' }); // asked: still in work
  // A plain release is refused while a task is in work (unchanged).
  ju.frame({ type: 'team_workspace', ref_id: 'r1', op: 'release', reply_ctx: roomKey(ws.id) });
  await tick();
  assert.deepEqual(ju.of('team_workspace_ack').at(-1), { type: 'team_workspace_ack', ref_id: 'r1', ok: false, error: 'busy' });
  // A stale claim pauses nothing.
  ju.frame({ type: 'team_workspace', ref_id: 'p0', op: 'release', park: true, claim: '999', reply_ctx: roomKey(ws.id) });
  await tick();
  assert.equal(ju.of('team_workspace_ack').at(-1).error, 'stale-claim');
  assert.equal(tasks.countActive(ws.id), 1);
  // park: the task is paused (not counted), the workspace is free.
  ju.frame({ type: 'team_workspace', ref_id: 'p1', op: 'release', park: true, claim: hub.store.claimId(ws.id), reply_ctx: roomKey(ws.id) });
  await tick();
  assert.equal(ju.of('team_workspace_ack').at(-1).ok, true);
  assert.equal(hub.store.workspaceOwner(ws.id), null);
  assert.equal(tasks.countActive(ws.id), 0);
  assert.equal(hub.store.activeTasks(ws.id), 0);
  assert.equal(tasks.countPaused(ws.id), 1);
  assert.equal(tasks.task(t1.id).status, 'asked', 'status kept, only paused');
  ju.frame({ type: 'team_workspace', ref_id: 'l1', op: 'list', reply_ctx: 'room-2' });
  await tick();
  assert.deepEqual(ju.of('team_workspace_ack').at(-1).rooms.map(r => [r.name, r.owner, r.active, r.paused]), [['工作区1', '', 0, 1]]);
  // Not claimed by anyone yet: the paused task resumes on its owner's next stance, and the
  // workspace is claimed back for general (the chat channel it was paused under).
  tasks.stance(t1.id, { actor: 'ds', stance: 'accept' });
  assert.equal(tasks.countActive(ws.id), 1);
  assert.equal(tasks.countPaused(ws.id), 0);
  assert.equal(hub.store.workspaceOwner(ws.id), 1);
});

test('team workspace park: a paused task does not resume into a workspace another chat channel claimed since', async () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'dev');
  const ws = hub.store.createWorkspace(1); // general owns 工作区1
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  hub.setMember({ id: 'ju', name: '橘', kind: 'bot', online: true });
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  const t1 = tasks.assign({ roomId: ws.id, title: '停在干净点的活', owner: 'ds', actor: 'ju' });
  tasks.stance(t1.id, { actor: 'ds', stance: 'ask', note: '等用户反馈' });
  assert.equal(tasks.park(ws.id), true);
  // dev's next workspace is the freed 工作区1, not 工作区2.
  assert.equal(hub.store.createWorkspace(2).name, '工作区1');
  assert.equal(hub.store.workspaceOwner(ws.id), 2);
  // Resuming would make 工作区1 serve two chat channels: refused, nothing changes.
  assert.throws(() => tasks.stance(t1.id, { actor: 'ds', stance: 'accept' }), e => e.code === 'workspace-owned');
  assert.equal(tasks.task(t1.id).status, 'asked');
  assert.ok(tasks.task(t1.id).paused_at != null, 'still paused, still listed');
  assert.equal(tasks.countPaused(ws.id), 1);
  assert.equal(tasks.countActive(ws.id), 0);
  assert.equal(hub.store.workspaceOwner(ws.id), 2, 'dev keeps it');
  // The paused task stays on general's board (a to-do is not lost), not on dev's.
  assert.deepEqual(tasks.list(1).map(t => [t.id, t.paused_at != null]), [[t1.id, true]]);
  assert.deepEqual(tasks.list(2).map(t => t.id), []);
});

test('team workspace park: a workspace with one paused and one accepted task stays busy for a plain release', async () => {
  const hub = makeHub();
  const ws = hub.store.createWorkspace(1);
  hub.setMember({ id: 'ds', name: 'DeepSeek', kind: 'dsh', online: true });
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  gw.tasks = tasks;
  connect(gw, 'bot=ju&name=橘');
  const a = tasks.assign({ roomId: ws.id, title: 'A', owner: 'ds', actor: 'ju' });
  tasks.db.prepare('UPDATE tasks SET paused_at = 1 WHERE id = ?').run(a.id);
  const b = tasks.assign({ roomId: ws.id, title: 'B', owner: 'ds', actor: 'ju' });
  tasks.stance(b.id, { actor: 'ds', stance: 'accept' });
  assert.equal(tasks.countActive(ws.id), 1);
  assert.throws(() => tasks.release(ws.id), /tasks in work/);
  assert.notEqual(hub.store.workspaceOwner(ws.id), null);
});

test('POST /collab/api/rooms/{id}/workspaces: owner and bot token create 工作区n+1, others get 401', async () => {
  const { workspacesRoute } = await import('./plugin.mjs');
  const hub = makeHub();
  const gateway = new CloudWebGateway(hub, { token: 'secret', logger: quiet });
  const events = [];
  hub.subscribe(e => events.push(e));
  const call = async (headers, isOwner = false, path = '/collab/api/rooms/1/workspaces') => {
    const res = { status: 0, body: undefined, writeHead(code) { this.status = code; }, end(b) { this.body = JSON.parse(b); } };
    const req = { method: 'POST', headers };
    const done = workspacesRoute(req, res, new URL(path, 'http://x'), { store: hub.store, hub, gateway, owner: () => isOwner });
    assert.notEqual(done, undefined);
    await done;
    return res;
  };
  const bot = await call({ authorization: 'Bearer secret' });
  assert.equal(bot.status, 200);
  assert.deepEqual([bot.body.workspace.name, bot.body.workspace.parent_id], ['工作区1', 1]);
  const own = await call({}, true);
  assert.equal(own.body.workspace.name, '工作区2');
  assert.equal((await call({ authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ authorization: 'Bearer secret' }, false, '/collab/api/rooms/42/workspaces')).status, 404);
  const last = events.filter(e => e.type === 'rooms').at(-1);
  assert.deepEqual(last.rooms.map(r => [r.name, r.kind, r.parent_id, r.active]),
    [['general', 'chat', null, 0], ['工作区1', 'workspace', 1, 0], ['工作区2', 'workspace', 1, 0]]);
  assert.equal(workspacesRoute({ method: 'GET', headers: {} }, {}, new URL('http://x/collab/api/rooms/1/workspaces'), {}), undefined);
});

test('cloud-web: team_workspace frames (team mode E)', async () => {
  // A store without team mode A's createWorkspace: no capability, frames answered "unsupported".
  const hub = makeHub();
  hub.store.createWorkspace = undefined;
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  assert.equal(ju.of('register_ack')[0].capabilities.includes('team_workspace'), false);
  ju.frame({ type: 'team_workspace', ref_id: 'w1', op: 'list', reply_ctx: 'room-1' });
  await tick();
  assert.deepEqual(ju.of('team_workspace_ack').at(-1), { type: 'team_workspace_ack', ref_id: 'w1', ok: false, error: 'unsupported' });
});

test('cloud-web: team_workspace create on the real store (A #134) makes 工作区1 and answers', async () => {
  const hub2 = makeHub();
  const { store } = hub2;
  assert.deepEqual(store.rooms().filter(r => r.kind === 'workspace'), [], 'A no longer creates 工作区1 up front');
  const events = [];
  hub2.subscribe(e => events.push(e));
  const gw2 = new CloudWebGateway(hub2, { token: 't', logger: quiet });
  const ju2 = connect(gw2, 'bot=ju&name=橘');
  assert.equal(ju2.of('register_ack')[0].capabilities.includes('team_workspace'), true);
  ju2.frame({ type: 'team_workspace', ref_id: 'w2', op: 'list', session_key: 'cloud_web:room-1', reply_ctx: 'room-1' });
  await tick();
  assert.deepEqual(ju2.of('team_workspace_ack').at(-1), { type: 'team_workspace_ack', ref_id: 'w2', ok: true, self: { id: 'room-1', name: 'general' }, rooms: [] });
  ju2.frame({ type: 'team_workspace', ref_id: 'w3', op: 'create', reply_ctx: 'room-1' });
  await tick();
  const ack = ju2.of('team_workspace_ack').at(-1);
  assert.equal(ack.ok, true);
  assert.equal(ack.room.name, '工作区1');
  assert.ok(Number(ack.room.id.replace('room-', '')) >= 1000000, 'workspace ids start at 1000000');
  const w = store.room(Number(ack.room.id.replace('room-', '')));
  assert.equal(w.kind, 'workspace');
  assert.equal(w.parent_id, 1);
  assert.equal(events.at(-1).type, 'rooms');
  ju2.frame({ type: 'team_workspace', ref_id: 'w4', op: 'create', reply_ctx: 'room-1' });
  await tick();
  assert.equal(ju2.of('team_workspace_ack').at(-1).room.name, '工作区2');
  ju2.frame({ type: 'team_workspace', ref_id: 'w5', op: 'list', reply_ctx: 'room-1' });
  await tick();
  assert.deepEqual(ju2.of('team_workspace_ack').at(-1).rooms.map(r => r.name), ['工作区1', '工作区2']);
  // The list carries each workspace's parent and tasks in progress, so the bridge skips busy ones.
  gw2.tasks = { countActive: id => (id === w.id ? 2 : 0) };
  ju2.frame({ type: 'team_workspace', ref_id: 'w5a', op: 'list', reply_ctx: 'room-1' });
  await tick();
  assert.deepEqual(ju2.of('team_workspace_ack').at(-1).rooms.map(r => [r.name, r.parent_id, r.active]),
    [['工作区1', 'room-1', 2], ['工作区2', 'room-1', 0]]);
  // Another chat channel sees the whole pool, not only the workspaces it created.
  store.ensureRoom(2, 'dev');
  ju2.frame({ type: 'team_workspace', ref_id: 'w5b', op: 'list', reply_ctx: 'room-2' });
  await tick();
  assert.deepEqual(ju2.of('team_workspace_ack').at(-1).rooms.map(r => r.name), ['工作区1', '工作区2']);
  ju2.frame({ type: 'team_workspace', ref_id: 'w6', op: 'list', reply_ctx: 'room-9' });
  await tick();
  assert.equal(ju2.of('team_workspace_ack').at(-1).error, 'room-missing');
});

test('tasks: assign with reason shows reason in the record (team mode C)', () => {
  const { hub, tasks } = makeTasks();
  const t = tasks.assign({ roomId: 1, title: '写测试', owner: 'ds', actor: 'lead', reason: '按文字功底选定' });
  assert.equal(t.reason, '按文字功底选定');
  const record = hub.store.message(t.assign_msg_id);
  assert.ok(record);
  assert.match(record.text, /理由：按文字功底选定/);
});

test('dispatch mode mixed: @ a member does not post an automated reason note (PR #138 review 8)', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  assert.equal(hub.store.dispatchMode(1), 'mixed');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 帮忙写个小脚本' });
  await settle();
  const notes = hub.store.page(1, undefined, 20).filter(m => m.text.includes('混合派活') || m.text.includes('原因：'));
  assert.equal(notes.length, 0, 'no automated reason note is posted in mixed mode');
});

test('tasks: cross-workspace busy check rejects dispatch unless force: true', () => {
  const { hub, tasks, clock } = makeTasks();
  hub.store.ensureRoom(2, '工作区1');
  // Dispatch in room 1 to ds
  const t1 = tasks.assign({ roomId: 1, title: '写前台代码', owner: 'ds', actor: 'lead' });
  assert.equal(t1.status, 'assigned');

  // Attempting to dispatch to ds in room 2 without force fails
  assert.throws(
    () => tasks.assign({ roomId: 2, title: '写后端接口', owner: 'ds', actor: 'lead' }),
    (err) => err.code === 'member-busy' && err.message.includes('DeepSeek 在「#general」已有进行中的任务')
  );

  // Dispatching with force: true succeeds and adds busy note
  const t2 = tasks.assign({ roomId: 2, title: '写后端接口', owner: 'ds', actor: 'lead', force: true });
  assert.equal(t2.status, 'assigned');
  const record2 = hub.store.message(t2.assign_msg_id);
  assert.match(record2.text, /注：该成员在「#general」已有进行中任务 #1/);

  // When task 1 is finished (returned and done), ds is still busy with task 2
  tasks.stance(t1.id, { actor: 'ds', stance: '接' });
  const { message: deliv } = hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '前台完工' });
  tasks.handBack(t1.id, { actor: 'ds', messageId: deliv.id });
  tasks.review(t1.id, { actor: 'lead', verdict: 'done' });

  // ds is still busy because t2 is in progress
  assert.throws(
    () => tasks.assign({ roomId: 1, title: '第三个活', owner: 'ds', actor: 'lead' }),
    (err) => err.code === 'member-busy' && err.message.includes('在「#工作区1」已有进行中的任务 #2')
  );
});

test('memberStatus: displays cross-workspace busy task and duration', () => {
  const { hub, tasks, clock } = makeTasks();
  hub.store.ensureRoom(2, '工作区1');
  tasks.assign({ roomId: 2, title: '实现忙碌检查', owner: 'ds', actor: 'lead' });

  const statusStr = memberStatus(hub, tasks);
  assert.match(statusStr, /DeepSeek \(ds\)：在#工作区1忙碌（任务 #1「实现忙碌检查」，已用时 0 秒）/);
  assert.match(statusStr, /橘 \(lead\)：空闲/);

  // Advance clock by 3 minutes
  clock.t += 180;
  const statusAfter3m = memberStatus(hub, tasks);
  assert.match(statusAfter3m, /已用时 3 分钟/);
});

test('tasks: assigning a subtask to the parent task owner is not blocked by ancestors', () => {
  const { hub, tasks } = makeTasks();
  hub.store.ensureRoom(2, '工作区1');
  // Root task assigned to ds
  const parent = tasks.assign({ roomId: 1, title: '主任务', owner: 'ds', actor: 'lead' });
  assert.equal(parent.status, 'assigned');

  // Subtask assigned to ds with parentTask = parent.id should succeed without force
  const sub1 = tasks.assign({ roomId: 2, title: '子任务拆解', owner: 'ds', actor: 'lead', parentTask: parent.id });
  assert.equal(sub1.status, 'assigned');
  assert.equal(sub1.parent_task, parent.id);

  // Sub-subtask assigned to ds with parentTask = sub1.id also succeeds
  const sub2 = tasks.assign({ roomId: 2, title: '孙任务拆解', owner: 'ds', actor: 'lead', parentTask: sub1.id });
  assert.equal(sub2.status, 'assigned');
  assert.equal(sub2.parent_task, sub1.id);

  // But assigning an independent new task to ds without parentTask is blocked
  assert.throws(
    () => tasks.assign({ roomId: 1, title: '无关任务', owner: 'ds', actor: 'lead' }),
    (err) => err.code === 'member-busy' && err.message.includes('确需并行派请带 force')
  );
});


test('dispatch settings: migration distinguishes generated mixed rows and persists explicit mixed', () => {
  const s = new Store(':memory:');
  s.ensureRoom(1, 'general'); s.ensureRoom(2, 'other');
  s.dispatchMode(1); s.setDispatchMode(2, 'team');
  s.db.exec('ALTER TABLE room_settings DROP COLUMN dispatch_explicit; PRAGMA user_version = 9');
  s.ensureSchema();
  assert.deepEqual(s.dispatchSetting(1), { dispatch_mode: 'mixed', dispatch_explicit: false });
  assert.deepEqual(s.dispatchSetting(2), { dispatch_mode: 'team', dispatch_explicit: true });
  s.setDispatchMode(1, 'mixed');
  const ws = s.createWorkspace(1);
  s.ensureSchema();
  assert.deepEqual(s.dispatchSetting(ws.id), { dispatch_mode: 'mixed', dispatch_explicit: true });
  const hub = new Hub(s, quiet);
  const gateway = new CloudWebGateway(hub, quiet);
  assert.deepEqual(gateway.teamWorkspace({ op: 'dispatch_mode', reply_ctx: roomKey(ws.id) }), { ok: true, dispatch_mode: 'mixed', dispatch_explicit: true });
  s.close();
});

test('store: upgrading to single owner puts old workspaces with no task in work in the pool', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'collab-')), 'collab.sqlite3');
  const old = new Store(path);
  old.ensureRoom(1, 'general');
  old.ensureRoom(2, 'dev');
  const idle = old.createWorkspace(1);
  const busy = old.createWorkspace(1);
  old.db.prepare(`INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at)
    VALUES (?, '旧活', 'ds', 'lead', ?, 1, 1)`).run(idle.id, 'done');
  old.db.prepare(`INSERT INTO tasks (room_id, title, owner, created_by, status, created_at, updated_at)
    VALUES (?, '还在做', 'ds', 'lead', ?, 1, 1)`).run(busy.id, 'accepted');
  // Shape before single owner: no free / claim_task / claim_bridge columns.
  for (const c of ['free', 'claim_task', 'claim_bridge']) old.db.exec(`ALTER TABLE rooms DROP COLUMN ${c}`);
  old.close();
  const s = new Store(path);
  assert.equal(s.workspaceOwner(idle.id), null, 'done before the upgrade: free');
  assert.equal(s.claimWorkspace(2, idle.id).parent_id, 2, 'another chat channel claims it');
  assert.equal(s.workspaceOwner(busy.id), 1, 'a task still in work keeps its owner');
  assert.throws(() => s.claimWorkspace(2, busy.id), e => e.code === 'workspace-owned');
  s.close();
  const again = new Store(path); // the migration runs once: dev keeps what it claimed
  assert.equal(again.workspaceOwner(idle.id), 2);
  again.close();
});

test('tasks: a subtask handed back while the handoff is open keeps the workspace; the handoff done releases it', () => {
  const { hub } = makeTasks();
  const s = hub.store;
  s.ensureRoom(2, 'dev');
  const w = s.createWorkspace(1);
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  const released = [];
  tasks.onRelease(id => released.push(id));
  const msg = () => s.append(w.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '交回' }).message.id;
  const handoff = tasks.assign({ roomId: w.id, title: '整块活', owner: 'lead', actor: 'owner' });
  const sub = tasks.assign({ roomId: w.id, title: '子任务', owner: 'ds', actor: 'lead', parentTask: handoff.id, force: true });
  tasks.handBack(sub.id, { actor: 'ds', messageId: msg() });
  tasks.review(sub.id, { actor: 'lead', verdict: 'done' });
  assert.equal(s.workspaceOwner(w.id), 1, 'the lead is still summing up: owned');
  assert.throws(() => s.claimWorkspace(2, w.id), e => e.code === 'workspace-owned');
  tasks.handBack(handoff.id, { actor: 'lead', messageId: msg() });
  assert.equal(s.workspaceOwner(w.id), null, 'handoff handed back, nothing in work: released');
  assert.deepEqual(released, [w.id]);
});

test('tasks: a bridge-claimed workspace is never auto-released; only the bridge release frees it', () => {
  const { hub } = makeTasks();
  const s = hub.store;
  s.ensureRoom(2, 'dev');
  const w = s.createWorkspace(1, { bridge: true });
  const tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  const t = tasks.assign({ roomId: w.id, title: '子任务', owner: 'ds', actor: 'lead' });
  tasks.handBack(t.id, { actor: 'ds', messageId: s.append(w.id, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '交回' }).message.id });
  tasks.review(t.id, { actor: 'lead', verdict: 'done' });
  assert.equal(s.workspaceOwner(w.id), 1, 'the bridge lead may still be working');
  assert.equal(tasks.release(w.id), true);
  assert.equal(s.claimWorkspace(2, w.id, { bridge: true }).parent_id, 2);
});

test('cloud_web release names the claim it ends: a late release does not free a newer claim', async () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'dev');
  const ws = hub.store.createWorkspace(1);
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  gw.tasks = new Tasks(hub, { setTimer: () => ({}), clearTimer() {} });
  const ju = connect(gw, 'bot=ju&name=橘');
  const ack = () => ju.of('team_workspace_ack').at(-1);
  ju.frame({ type: 'team_workspace', ref_id: 'c1', op: 'claim', reply_ctx: 'room-1', workspace_id: roomKey(ws.id) });
  await tick();
  const first = ack().room.claim;
  ju.frame({ type: 'team_workspace', ref_id: 'c2', op: 'claim', reply_ctx: 'room-1', workspace_id: roomKey(ws.id) });
  await tick();
  const second = ack().room.claim;
  assert.notEqual(first, second, 'every claim gets its own id');
  // The release for the first claim arrives after the second claim: refused, still owned.
  ju.frame({ type: 'team_workspace', ref_id: 'r1', op: 'release', reply_ctx: roomKey(ws.id), claim: first });
  await tick();
  assert.deepEqual(ack(), { type: 'team_workspace_ack', ref_id: 'r1', ok: false, error: 'stale-claim' });
  assert.equal(hub.store.workspaceOwner(ws.id), 1);
  ju.frame({ type: 'team_workspace', ref_id: 'c3', op: 'claim', reply_ctx: 'room-2', workspace_id: roomKey(ws.id) });
  await tick();
  assert.equal(ack().error, 'workspace-owned');
  // The release naming the current claim frees it.
  ju.frame({ type: 'team_workspace', ref_id: 'r2', op: 'release', reply_ctx: roomKey(ws.id), claim: second });
  await tick();
  assert.equal(ack().ok, true);
  assert.equal(hub.store.workspaceOwner(ws.id), null);
});

test('#144 attachments: stored on the message, shown publicly, forwarded to bots as images/files', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Attachments } = await import('./attachments.mjs');
  const { publicMessage } = await import('./store.mjs');
  const files = new Attachments(join(mkdtempSync(join(tmpdir(), 'collab-att-')), 'attachments'));
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet, files });
  const ju = connect(gw, 'bot=ju&name=橘');
  await settle();

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const attachments = files.save([
    { name: 'shot.png', mime: 'image/png', data: png.toString('base64') },
    { name: 'run.log', mime: 'text/plain', data: Buffer.from('boom').toString('base64') },
  ]);
  assert.equal(attachments.length, 2);
  assert.deepEqual(files.read(attachments[0].id), png);
  assert.equal(files.read('../etc/passwd'), undefined);

  // A message may carry only attachments.
  const { message } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '', attachments });
  const view = publicMessage(message, hub.store);
  assert.deepEqual(view.attachments.map(a => [a.name, a.mime, a.size]), [['shot.png', 'image/png', 4], ['run.log', 'text/plain', 4]]);
  assert.equal(hub.store.attachmentMeta(attachments[1].id).name, 'run.log');
  assert.equal(hub.store.attachmentMeta('00000000-0000-0000-0000-000000000000'), undefined);

  await settle();
  const frame = ju.of('message').at(-1);
  assert.deepEqual(frame.images, [{ mime_type: 'image/png', data: png.toString('base64'), file_name: 'shot.png' }]);
  assert.deepEqual(frame.files, [{ mime_type: 'text/plain', data: Buffer.from('boom').toString('base64'), file_name: 'run.log' }]);

  assert.throws(() => files.save([{ name: 'x', mime: 'text/plain', data: '' }]), /empty/);
  assert.throws(() => hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '' }), /empty/);
});

test('#144 attachments: only png/jpeg/gif/webp up to 5 MB go to bots as images, the rest as files', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Attachments, MAX_IMAGE_BYTES } = await import('./attachments.mjs');
  const files = new Attachments(join(mkdtempSync(join(tmpdir(), 'collab-att-')), 'attachments'));
  const b64 = (buf) => buf.toString('base64');
  const saved = files.save([
    { name: 'a.png', mime: 'image/png', data: b64(Buffer.from('png')) },
    { name: 'b.svg', mime: 'image/svg+xml', data: b64(Buffer.from('<svg/>')) },
    { name: 'c.heic', mime: 'image/heic', data: b64(Buffer.from('heic')) },
    { name: 'd.jpg', mime: 'image/jpeg', data: b64(Buffer.alloc(MAX_IMAGE_BYTES + 1, 1)) },
  ]);
  const wire = files.wire(saved);
  assert.deepEqual(wire.images.map(i => i.file_name), ['a.png']);
  assert.deepEqual(wire.files.map(f => f.file_name), ['b.svg', 'c.heic', 'd.jpg']);
});

test('bot image/file/audio frames become channel attachments; media capabilities need a store', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Attachments } = await import('./attachments.mjs');
  const { publicMessage } = await import('./store.mjs');
  const { MEDIA_CAPABILITIES, audioMime } = await import('./cloudweb.mjs');
  const files = new Attachments(join(mkdtempSync(join(tmpdir(), 'collab-media-')), 'attachments'));
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet, files });
  const ju = connect(gw, 'bot=ju&name=橘');
  await settle();
  for (const cap of MEDIA_CAPABILITIES) assert.ok(ju.of('register_ack')[0].capabilities.includes(cap), cap);
  const plain = connect(new CloudWebGateway(makeHub(), { token: 't', logger: quiet }), 'bot=ju&name=橘');
  await settle();
  assert.ok(!plain.of('register_ack')[0].capabilities.includes('image'));

  const b64 = (s) => Buffer.from(s).toString('base64');
  const at = { session_key: 'cloud_web:room-1', reply_ctx: 'room-1' };
  ju.frame({ type: 'image', ...at, data: b64('png'), mime_type: 'image/png', file_name: 'chart.png' });
  ju.frame({ type: 'file', ...at, data: b64('report'), mime_type: 'application/pdf', file_name: 'report.pdf' });
  ju.frame({ type: 'audio', ...at, data: b64('mp3'), format: 'mp3' });
  ju.frame({ type: 'image', ...at, data: '' });
  ju.frame({ type: 'file', session_key: 'cloud_web:room-99', data: b64('x'), file_name: 'lost.txt' });
  await settle();

  const rows = hub.store.page(1, undefined, 10).map(r => publicMessage(r, hub.store));
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.author === 'ju' && r.text === ''));
  assert.deepEqual(rows.map(r => r.attachments.map(a => [a.name, a.mime])), [
    [['chart.png', 'image/png']], [['report.pdf', 'application/pdf']], [['voice.mp3', 'audio/mpeg']],
  ]);
  assert.equal(files.read(rows[2].attachments[0].id).toString(), 'mp3');
  assert.equal(audioMime('ogg'), 'audio/ogg');
  assert.equal(audioMime('opus'), 'audio/ogg');
  assert.equal(audioMime(''), 'audio/mpeg');
});

test('bot websocket cap fits a default 50 MiB cc-connect attachment; a 7 MiB file frame is stored', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Attachments } = await import('./attachments.mjs');
  const { publicMessage } = await import('./store.mjs');
  const { BOT_WS_MAX_PAYLOAD } = await import('./plugin.mjs');
  const frameFor = (n) => JSON.stringify({ type: 'file', session_key: 'cloud_web:room-1', reply_ctx: 'room-1',
    data: Buffer.alloc(n).toString('base64'), mime_type: 'application/octet-stream', file_name: 'big.bin' });
  assert.ok(Buffer.byteLength(frameFor(50 * 1024 * 1024)) <= BOT_WS_MAX_PAYLOAD);

  const files = new Attachments(join(mkdtempSync(join(tmpdir(), 'collab-big-')), 'attachments'));
  const hub = makeHub();
  const ju = connect(new CloudWebGateway(hub, { token: 't', logger: quiet, files }), 'bot=ju&name=橘');
  await settle();
  const big = Buffer.alloc(7 * 1024 * 1024, 7);
  ju.frame({ type: 'file', session_key: 'cloud_web:room-1', reply_ctx: 'room-1', data: big.toString('base64'),
    mime_type: 'application/octet-stream', file_name: 'big.bin' });
  await settle();
  const [row] = hub.store.page(1, undefined, 10).map(r => publicMessage(r, hub.store));
  assert.deepEqual(row.attachments.map(a => [a.name, a.size]), [['big.bin', big.length]]);
  assert.ok(files.read(row.attachments[0].id).equals(big));
});

test('attachment download: 200 without Range, 206 for byte ranges, 416 out of range', async () => {
  const { createServer } = await import('node:http');
  const { sendAttachment, parseRange } = await import('./plugin.mjs');
  const bytes = Buffer.from('0123456789');
  const server = createServer((req, res) => sendAttachment(req, res, { mime: 'audio/mpeg', name: 'voice.mp3' }, bytes));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const get = (range) => fetch(`http://127.0.0.1:${server.address().port}/`, range === undefined ? {} : { headers: { range } });
  try {
    const all = await get();
    assert.equal(all.status, 200);
    assert.equal(all.headers.get('accept-ranges'), 'bytes');
    assert.equal(all.headers.get('content-length'), '10');
    assert.equal(all.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await all.text(), '0123456789');
    for (const [range, body, cr] of [['bytes=2-4', '234', 'bytes 2-4/10'], ['bytes=7-', '789', 'bytes 7-9/10'],
      ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=0-99', '0123456789', 'bytes 0-9/10'], ['bytes=0-1', '01', 'bytes 0-1/10']]) {
      const res = await get(range);
      assert.equal(res.status, 206, range);
      assert.equal(res.headers.get('content-range'), cr, range);
      assert.equal(res.headers.get('content-length'), String(body.length), range);
      assert.equal(res.headers.get('accept-ranges'), 'bytes', range);
      assert.equal(await res.text(), body, range);
    }
    for (const range of ['bytes=10-', 'bytes=99-120', 'bytes=-0']) {
      const res = await get(range);
      assert.equal(res.status, 416, range);
      assert.equal(res.headers.get('content-range'), 'bytes */10', range);
      await res.arrayBuffer();
    }
    assert.equal((await get('items=0-1')).status, 200);
    assert.equal(parseRange('bytes=0-1,4-5', 10), undefined);
  } finally { server.close(); }
});

test('#144 oversized POST body gets a 413 response instead of a dropped connection', async () => {
  const { createServer } = await import('node:http');
  const { withBody } = await import('./plugin.mjs');
  const server = createServer((req, res) => { withBody(req, res, async () => ({ ok: true }), true, 1024); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', body: 'x'.repeat(256 * 1024) });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).code, 'too-large');
  } finally { server.close(); }
});

test('retry failed message (#146): store.retryJob resets a failed job, DshMembers.retry re-queues and clears error', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const realCreate = dsh.ctx.agents.create.bind(dsh.ctx.agents);
  let shouldFail = true;
  dsh.ctx.agents.create = async (o) => {
    const h = await realCreate(o);
    const origFollowup = h.agent.followup.bind(h.agent);
    h.agent.followup = (m) => {
      if (shouldFail) throw Error('quota exhausted');
      return origFollowup(m);
    };
    return h;
  };

  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek run' });
  await settle();

  // It should have failed and left a system error card
  const failedMsg = hub.store.page(1, undefined, 1)[0];
  assert.equal(failedMsg.author_kind, 'system');
  assert.match(failedMsg.text, /quota exhausted/);
  assert.match(hub.memberView().find(m => m.id === 'ds').error, /quota exhausted/);
  const cardData = JSON.parse(failedMsg.card);
  assert.equal(cardData.state, 'failed');
  assert.equal(cardData.member_id, 'ds');

  // Now trigger retry
  shouldFail = false;
  const userTrigger = hub.store.message(cardData.trigger_id);
  assert.ok(userTrigger);
  const retried = members.retry('ds', userTrigger);
  assert.equal(retried, true);
  // Error should be cleared
  assert.equal(hub.memberView().find(m => m.id === 'ds').error, undefined);
  await settle();

  // DSH turn succeeded now
  dsh.turn(dsh.sessions.get(dsh.made[0]), ['重试成功']);
  await settle();
  const latest = hub.store.page(1, undefined, 1)[0];
  assert.equal(latest.author, 'ds');
  assert.equal(latest.text, '重试成功');
});


test('#148 editing a reply keeps its quote for the edit response and the browser event', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const events = [];
  hub.subscribe(e => events.push(e));
  const call = route(hub, gw, { recall: () => [] });
  const { message: quoted } = hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '原话' });
  const { message: reply } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '回一句', replyTo: quoted.id });
  const ok = await call('PATCH', `/collab/api/messages/${reply.id}`, { text: '改过的回复' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.message.reply_to?.id, quoted.id, 'the edited reply still quotes its message');
  assert.equal(events.at(-1).message.reply_to?.id, quoted.id);
});

test('#148 owner edits own message: text and edited_at change, others and cards are refused, browsers told', async () => {
  const hub = makeHub();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const events = [];
  hub.subscribe(e => events.push(e));
  const call = route(hub, gw, { recall: () => [] });
  const { message: mine } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '打错字了' });
  const { message: bot } = hub.post(1, { authorKind: 'role', author: 'ju', name: '橘', text: '收到' });
  const ok = await call('PATCH', `/collab/api/messages/${mine.id}`, { text: '改好了' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.message.text, '改好了');
  assert.equal(typeof ok.json.message.edited_at, 'number');
  assert.equal(hub.store.message(mine.id).text, '改好了');
  assert.equal(events.at(-1).type, 'message');
  assert.equal(events.at(-1).message.edited_at, ok.json.message.edited_at);
  assert.equal((await call('PATCH', `/collab/api/messages/${bot.id}`, { text: 'x' })).status, 403, 'not the owner\'s message');
  assert.equal(hub.store.message(bot.id).text, '收到');
  assert.equal((await call('PATCH', `/collab/api/messages/${mine.id}`, { text: '  ' })).status, 400, 'empty text');
  assert.equal((await call('PATCH', '/collab/api/messages/999', { text: 'x' })).status, 403);
  assert.equal(hub.store.page(1).find(m => m.id === bot.id).edited_at, null, 'an unedited row has no edited_at');
});

test('#148 owner withdraws own message: row hidden, bots get message_recall, DSH jobs not started end quietly', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }, { id: 'qw', name: 'Qwen' }]);
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const ju = connect(gw, 'bot=ju&name=橘');
  const events = [];
  hub.subscribe(e => events.push(e));
  const call = route(hub, gw, members);

  // DeepSeek is busy with an earlier turn, so this @ waits in its queue (pending); Qwen admits it (sent, not yet in a turn).
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 先做这个' });
  await settle();
  const { message: wrong } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek @Qwen @橘 发错了' });
  await settle();
  assert.equal(ju.of('message').at(-1).msg_id, `hub-${wrong.id}`);
  const qwen = dsh.sessions.get(hub.store.binding('qw', 1).session_id);
  assert.equal(qwen.inbox.nextTurn.length, 1);

  const res = await call('DELETE', `/collab/api/messages/${wrong.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.recalled, ['ju']);
  assert.deepEqual(res.json.still_running, []);
  assert.deepEqual(res.json.stopped, []);
  assert.deepEqual(ju.of('message_recall').at(-1), { type: 'message_recall', msg_id: `hub-${wrong.id}` });
  assert.equal(hub.store.message(wrong.id), undefined, 'hidden from history');
  assert.deepEqual(events.find(e => e.type === 'deleted'), { type: 'deleted', id: wrong.id, room_id: 1 });
  assert.equal(qwen.inbox.nextTurn.length, 0, 'the input waiting in Qwen\'s inbox is taken back');
  members.onDiscarded(qwen.session.id, qwen.prompts[0].id);
  // DeepSeek finishes its earlier turn; the withdrawn job must not start.
  const ds = dsh.sessions.get(hub.store.binding('ds', 1).session_id);
  dsh.turn(ds, ['第一件做完了']);
  await settle();
  assert.equal(ds.prompts.length, 1, 'the queued job for the withdrawn message never runs');
  assert.equal(hub.store.openJobs().length, 0);
  assert.equal(hub.store.page(1).filter(m => m.author_kind === 'system').length, 0, 'no failure card for a withdrawal');
  assert.equal(hub.thinking.get(1).has('qw'), false);
});

test('#148 withdrawing stops a DSH turn already running, keeps its queue, posts nothing; others\' messages stay', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const call = route(hub, gw, members);
  const { message: m } = hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 跑起来' });
  await settle();
  const ds = dsh.sessions.get(hub.store.binding('ds', 1).session_id);
  dsh.turn(ds, [], null); // the turn takes the input and is still running
  assert.equal(hub.thinking.get(1).has('ds'), true);
  const res = await call('DELETE', `/collab/api/messages/${m.id}`);
  assert.deepEqual(res.json.stopped, ['DeepSeek']);
  assert.deepEqual(res.json.still_running, []);
  assert.deepEqual(ds.cancels, [[{ kind: 'user' }, { keepInbox: true }]], 'cancelled like DSH\'s stop button');
  await settle();
  // The cancelled turn ends with partial text; it must not become a reply or a failure card.
  dsh.emit(ds, 'assistant/message', { message: { content: [{ type: 'text', text: '半截' }] } });
  dsh.emit(ds, 'turn/end', { turn: 1, reason: { kind: 'cancelled' } });
  await settle();
  assert.equal(hub.store.page(1).filter(r => r.author_kind !== 'user').length, 0);
  assert.equal(hub.store.openJobs().length, 0);
  assert.equal(hub.thinking.get(1).has('ds'), false);
  const { message: bot } = hub.post(1, { authorKind: 'role', author: 'ds', name: 'DeepSeek', text: '回复' });
  assert.equal((await call('DELETE', `/collab/api/messages/${bot.id}`)).status, 403);
  assert.notEqual(hub.store.message(bot.id), undefined);
});

function route(hub, gateway, dsh) {
  return async (method, path, body) => {
    const req = new EventEmitter();
    req.method = method; req.url = path; req.headers = {};
    const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
    const p = ownMessageRoute(req, res, path, { store: hub.store, hub, gateway, dsh });
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
    await p;
    return { status: res.status, json: JSON.parse(res.body) };
  };
}

test('tasks: the lead @-ing teammates opens board tasks; their reply to the lead hands back; the lead\'s next message accepts', async () => {
  const { hub, tasks } = makeTasks();
  hub.fallbackLead = 'lead';
  hub.setMember({ id: 'gpt', name: '龙娘', kind: 'bot', online: true });
  const say = (author, name, text) => hub.post(1, { authorKind: 'role', author, name, text }).message;
  const dispatch = say('lead', '橘', '@龙娘 @DeepSeek 把登录页写完\n细节见上');
  await tick();
  let list = tasks.list(1);
  assert.deepEqual(list.map(t => [t.owner, t.status, t.title, t.assign_msg_id]).sort(),
    [['ds', 'assigned', '把登录页写完', dispatch.id], ['gpt', 'assigned', '把登录页写完', dispatch.id]]);
  // A second @ to an owner with an open task from the lead is a follow-up, not a new task.
  say('lead', '橘', '@龙娘 记得加测试');
  await tick();
  assert.equal(tasks.list(1).length, 2);
  // Stance after the lead's @ (bridge lead_return form) still counts as a stance, not a hand-back.
  say('gpt', '龙娘', '@橘 【接】 开工');
  await tick();
  assert.equal(tasks.list(1).find(t => t.owner === 'gpt').status, 'accepted');
  // Bridge status notices never hand back.
  say('gpt', '龙娘', '⏳ @橘 还在跑');
  const result = say('gpt', '龙娘', '@橘 登录页写好了');
  await tick();
  list = tasks.list(1);
  assert.deepEqual([list.find(t => t.owner === 'gpt').status, list.find(t => t.owner === 'gpt').result_msg_id], ['returned', result.id]);
  assert.equal(list.find(t => t.owner === 'ds').status, 'assigned');
  say('lead', '橘', '收到，龙娘这份可以');
  await tick();
  list = tasks.list(1);
  assert.equal(list.find(t => t.owner === 'gpt').status, 'done');
  assert.equal(list.find(t => t.owner === 'ds').status, 'assigned');
  // Teammates' own @s and plain chat never open tasks; API tasks are never auto-accepted.
  say('gpt', '龙娘', '@DeepSeek 你那边呢');
  const api = tasks.assign({ roomId: 1, title: 'api', owner: 'gpt', actor: 'lead' });
  tasks.handBack(api.id, { actor: 'gpt', messageId: result.id });
  say('lead', '橘', '好');
  await tick();
  assert.equal(tasks.task(api.id).status, 'returned');
  assert.equal(tasks.list(1).length, 3);
  tasks.close(); hub.store.close();
});

test('tasks: a DSH member\'s one-message 【接】 reply is its delivery and hands the task back; a bot\'s stays a stance', async () => {
  const { hub, tasks } = makeTasks();
  hub.fallbackLead = 'lead';
  hub.setMember({ id: 'gpt', name: '龙娘', kind: 'bot', online: true });
  const say = (author, name, text) => hub.post(1, { authorKind: 'role', author, name, text }).message;
  say('lead', '橘', '@龙娘 @DeepSeek 把登录页写完');
  await tick();
  // A DSH member (local CLI members included) posts once, when its turn has ended:
  // dsh-member.mjs returnToLead puts the lead's @ in front of the stance.
  const result = say('ds', 'DeepSeek', '@橘 【接】\n登录页写好了，见 login.tsx');
  say('gpt', '龙娘', '@橘 【接】 开工');
  await tick();
  let list = tasks.list(1);
  assert.deepEqual([list.find(t => t.owner === 'ds').status, list.find(t => t.owner === 'ds').result_msg_id], ['returned', result.id]);
  assert.equal(list.find(t => t.owner === 'gpt').status, 'accepted', 'a bridge bot may keep working after its stance');
  say('lead', '橘', '收到');
  await tick();
  list = tasks.list(1);
  assert.equal(list.find(t => t.owner === 'ds').status, 'done');
  // 问 keeps the DSH member's turn on it: no hand-back.
  const asked = tasks.assign({ roomId: 1, title: 'q', owner: 'ds', actor: 'lead' });
  say('ds', 'DeepSeek', `@橘 【问】 #${asked.id} 要哪个分支`);
  await tick();
  assert.equal(tasks.task(asked.id).status, 'asked');
  tasks.close(); hub.store.close();
});

test('tasks: bridge task card members open and hand back board tasks (cloud-web task_members)', async () => {
  const { hub, tasks } = makeTasks();
  const gw = new CloudWebGateway(hub, { token: 'tok', logger: quiet });
  gw.tasks = tasks;
  hub.setMember({ id: 'gpt', name: '龙娘', kind: 'bot', online: true });
  const ws = new FakeWs();
  gw.accept(ws, new URL('ws://x/?bot=lead&name=橘'));
  ws.frame({ type: 'register', project: 'lead' });
  // Statuses as core.TaskMember writes them (task_members.go: report result -> completed);
  // the sub-row shares the teammate's reporter_project, as the bridge sends it.
  const card = (status, child = status) => PROGRESS_PREFIX + JSON.stringify({ state: 'running', items: [{ kind: 'info', text: '📋 t' }],
    task_members: [{ reporter_project: 'gpt', id: 'm1', name: '龙娘', title: '修 bug', status },
      { reporter_project: 'gpt', id: 'c1', parent_id: 'm1', name: 'subagent', title: 'x', status: child }] });
  ws.frame({ type: 'preview_start', ref_id: 'taskcard-1', reply_ctx: 'room-1', content: card('queued'), seq: 1 });
  await tick();
  const handle = ws.of('preview_ack')[0].preview_handle;
  let list = tasks.list(1);
  assert.deepEqual(list.map(t => [t.owner, t.created_by, t.status, t.title]), [['gpt', 'lead', 'assigned', '修 bug']]);
  ws.frame({ type: 'update_message', preview_handle: handle, content: card('running'), seq: 2 });
  await tick();
  assert.equal(tasks.list(1).length, 1);
  // A finished sub-row neither hands back the teammate's task nor lets the next frame reopen one.
  ws.frame({ type: 'update_message', preview_handle: handle, content: card('running', 'completed'), seq: 3 });
  ws.frame({ type: 'update_message', preview_handle: handle, content: card('running', 'completed'), seq: 4 });
  await tick();
  list = tasks.list(1);
  assert.deepEqual(list.map(t => t.status), ['assigned'], 'sub-rows are ignored');
  ws.frame({ type: 'update_message', preview_handle: handle, content: card('completed'), seq: 5 });
  await tick();
  list = tasks.list(1);
  assert.deepEqual([list[0].status, list[0].result_msg_id], ['returned', Number(handle)]);
  // A retried preview_start arriving late (older seq, member still queued) must not reopen a task.
  ws.frame({ type: 'preview_start', ref_id: 'taskcard-1', reply_ctx: 'room-1', content: card('queued'), seq: 1 });
  await tick();
  assert.deepEqual(tasks.list(1).map(t => t.status), ['returned'], 'late preview_start reopened a task');
  // Every terminal member status can reach hand-back, including the raw
  // public-progress `result` and the older `done` spelling.
  for (const [i, end] of ['result', 'completed', 'done', 'failed', 'cancelled', 'interrupted'].entries()) {
    const ref = `taskcard-${i + 2}`;
    ws.frame({ type: 'preview_start', ref_id: ref, reply_ctx: 'room-1', content: card('running'), seq: 1 });
    await tick();
    const h = ws.of('preview_ack').at(-1).preview_handle;
    ws.frame({ type: 'update_message', preview_handle: h, content: card(end), seq: 2 });
    await tick();
    const t = tasks.list(1).find(x => x.assign_msg_id === Number(h));
    assert.equal(t?.status, 'returned', `${end} hands back`);
  }
  tasks.close(); hub.store.close();
});

test('tasks: a 【问】【退】【升】 reply to the lead with no task to answer is not a hand-back', async () => {
  const { hub, tasks } = makeTasks();
  hub.fallbackLead = 'lead';
  hub.setMember({ id: 'gpt', name: '龙娘', kind: 'bot', online: true });
  const say = (author, name, text) => hub.post(1, { authorKind: 'role', author, name, text }).message;
  say('lead', '橘', '@龙娘 把登录页写完');
  await tick();
  say('gpt', '龙娘', '@橘 【接】 开工');
  await tick();
  for (const text of ['@橘 【问】接口用哪个版本', '@橘 【退】这个不归我', '@橘 【升】范围太大']) {
    say('gpt', '龙娘', text);
    await tick();
    assert.equal(tasks.list(1)[0].status, 'accepted', text);
  }
  say('lead', '橘', '用 v2');
  await tick();
  assert.equal(tasks.list(1)[0].status, 'accepted', 'the lead answering a question does not accept the task');
  tasks.close(); hub.store.close();
});

test('DSH member: tool calls post a live progress card that closes with the turn; replies stay out of relay depth', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: '大肥鱼' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@大肥鱼 查一下日志' });
  await settle();
  const agent = dsh.sessions.get(dsh.made[0]);
  dsh.turn(agent, [], null);
  const n = agent.turns;
  dsh.emit(agent, 'tool/call', { turn: n, step: 1, callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'tail -n 20 app.log' }) });
  await settle();
  const cardRow = () => hub.store.page(1, undefined, 10).find(m => m.card !== null);
  let row = cardRow();
  assert.equal(row.author, 'ds');
  let card = JSON.parse(row.card);
  assert.equal(card.title, '大肥鱼 · 处理中');
  assert.equal(card.steps, 1);
  assert.match(row.text, /bash — tail -n 20 app\.log/);
  assert.match(card.brief, /bash · 进行中/);
  dsh.emit(agent, 'tool/result', { turn: n, step: 1, message: { role: 'tool', toolCallId: 'c1' } });
  dsh.emit(agent, 'tool/call', { turn: n, step: 2, callId: 'c2', name: 'read', arguments: '{"path":"a.txt"}' });
  dsh.emit(agent, 'tool/result', { turn: n, step: 2, message: { role: 'tool', toolCallId: 'c2', isError: true } });
  await settle();
  card = JSON.parse(cardRow().card);
  assert.equal(card.steps, 2);
  assert.match(card.brief, /✅ bash · 成功/);
  assert.match(card.brief, /❌ read · 失败/);
  dsh.emit(agent, 'assistant/message', { message: { content: [{ type: 'text', text: '日志没问题' }] } });
  dsh.emit(agent, 'turn/end', { turn: n, reason: { kind: 'completed' } });
  await settle();
  const rows = hub.store.page(1, undefined, 10);
  assert.equal(rows.filter(m => m.card !== null).length, 1, 'one card per turn, edited in place');
  assert.equal(JSON.parse(cardRow().card).title, '大肥鱼 · 已完成');
  assert.equal(rows.at(-1).text, '日志没问题');
  assert.equal(hub.store.relayDepth(1, rows.at(-1).id), 1, 'the card is not a relay hop');
});

test('DSH member: a turn without tool calls posts no progress card', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: '大肥鱼' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@大肥鱼 在吗' });
  await settle();
  dsh.turn(dsh.sessions.get(dsh.made[0]), ['在']);
  await settle();
  assert.equal(hub.store.page(1, undefined, 10).filter(m => m.card !== null).length, 0);
});

test('DSH member: a thinking-only turn posts one completed card', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  dsh.attach(hub, [{ id: 'ds', name: '大肥鱼' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@大肥鱼 预测一下明天' });
  await settle();
  const agent = dsh.sessions.get(dsh.made[0]);
  dsh.turn(agent, [], null);
  const n = agent.turns;
  dsh.emit(agent, 'assistant/message', { turn: n, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: '先想想明天的行情' }, { type: 'text', text: '大概率震荡' }] } });
  await settle();
  assert.equal(JSON.parse(hub.store.page(1, undefined, 10).find(m => m.card !== null).card).title, '大肥鱼 · 处理中', 'thinking opens the card');
  dsh.emit(agent, 'turn/end', { turn: n, reason: { kind: 'completed' } });
  await settle();
  const rows = hub.store.page(1, undefined, 10);
  const cards = rows.filter(m => m.card !== null);
  assert.equal(cards.length, 1, 'a thinking-only turn still gets its card');
  assert.equal(JSON.parse(cards[0].card).title, '大肥鱼 · 已完成');
  assert.match(cards[0].text, /先想想明天的行情/);
  assert.equal(rows.at(-1).text, '大概率震荡');
});

test('CLI member: ACP thought chunks open the card and merge into one thinking line', async () => {
  const hub = makeHub();
  cliMembers(hub, async (_text, _room, _onText, onTool) => {
    onTool({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '先想想' } });
    onTool({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '明天的行情' } });
    await tick(); await tick();
    return '大概率震荡';
  });
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 预测一下明天' });
  await settle();
  const cards = hub.store.page(1, undefined, 10).filter(m => m.card !== null);
  assert.equal(cards.length, 1, 'a thinking-only turn still gets its card');
  assert.equal(JSON.parse(cards[0].card).title, 'CC · 已完成');
  assert.match(cards[0].text, /先想想明天的行情/);
});

test('CLI member: a turn with no thoughts and no tool calls posts no card', async () => {
  const hub = makeHub();
  cliMembers(hub, async () => '在');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 在吗' });
  await settle();
  assert.equal(hub.store.page(1, undefined, 10).filter(m => m.card !== null).length, 0);
});

test('TurnProgress: end() writes only after an event', () => {
  const posts = [];
  const hub = { post: (_r, m) => { posts.push(m); return { message: { id: posts.length } }; }, edit: () => {} };
  const member = { id: 'ds', name: '大肥鱼' };
  new TurnProgress(hub, 1, member, 1).end('completed');
  assert.equal(posts.length, 0, 'no events, no card');
  const p = new TurnProgress(hub, 1, member, 2);
  p.thought('嗯');
  p.end('completed');
  assert.equal(posts.length, 1);
  assert.equal(JSON.parse(posts[0].card).title, '大肥鱼 · 已完成');
});

test('CLI member: ACP tool calls feed the same progress card', async () => {
  const hub = makeHub();
  cliMembers(hub, async (_text, _room, _onText, onTool) => {
    onTool({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read', kind: 'read', status: 'pending', rawInput: { file_path: '/w/x.md' } });
    await tick(); await tick();
    onTool({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    onTool({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    return '看完了';
  });
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 看下 x.md' });
  await settle();
  const row = hub.store.page(1, undefined, 10).find(m => m.card !== null);
  const card = JSON.parse(row.card);
  assert.equal(card.title, 'CC · 已完成');
  assert.equal(card.brief.split('\n').length, 2, 'a repeated completed update adds no step');
  assert.match(card.brief, /✅ Read · 成功/);
  assert.match(row.text, /Read — \/w\/x\.md/);
});

test('CLI member: the placeholder binding becomes the real ACP sessionId, and a restart resumes it', async () => {
  const hub = makeHub();
  const asks = [];
  const first = cliMembers(hub, async (_text, _room, _onText, _onTool, opts) => {
    asks.push(opts.resumeId);
    opts.onSession({ sessionId: 'acp-1', lost: false });
    return '好';
  });
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 第一轮' });
  await settle();
  assert.deepEqual(asks, [undefined], 'the first turn has nothing to resume');
  assert.equal(hub.store.binding('cc', 1).session_id, 'acp-1', 'the placeholder cli:... is replaced by the ACP id');
  await first.close();
  const hub2 = makeHubFrom(hub.store);
  cliMembers(hub2, async (_text, _room, _onText, _onTool, opts) => {
    asks.push(opts.resumeId);
    opts.onSession({ sessionId: opts.resumeId, lost: false });
    return '接着';
  });
  hub2.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 重启后' });
  await settle();
  assert.deepEqual(asks, [undefined, 'acp-1'], 'after a restart the new instance asks to resume the stored id');
  assert.equal(hub2.store.page(1, undefined, 20).filter(m => m.author === 'system' && /新会话/.test(m.text)).length, 0);
});

test('CLI member: /new drops the stored ACP session, so the next turn does not resume it', async () => {
  const hub = makeHub();
  const asks = [];
  cliMembers(hub, async (_text, _room, _onText, _onTool, opts) => {
    asks.push(opts.resumeId);
    opts.onSession({ sessionId: `acp-${asks.length}`, lost: false });
    return '好';
  });
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 第一轮' });
  await settle();
  assert.equal(hub.store.binding('cc', 1).session_id, 'acp-1');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC /new' });
  await settle();
  assert.equal(hub.store.binding('cc', 1).session_id, 'cli:claude:cc:1', '/new points the binding back at the placeholder');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 新一轮' });
  await settle();
  assert.deepEqual(asks, [undefined, undefined], 'the turn after /new has no resumeId');
});

test('CLI member: /new also drops the ACP id saved from an exited process, so the next turn does not load it', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const asks = [];
  // Like CliAgent.ask: an empty resumeId falls back to the id saved when the process exited.
  const agent = {
    saved: new Map(),
    async ask(_text, room, _onText, _onTool, opts) {
      const prevId = opts.resumeId || this.saved.get(room);
      this.saved.delete(room);
      asks.push(prevId);
      opts.onSession({ sessionId: `acp-${asks.length}`, lost: false });
      return '好';
    },
    close() {},
  };
  new DshMembers(hub, { ctx: dsh.ctx, createUserMessage: m => m, createCliMember: () => agent, workspacePath: '/w', logger: quiet },
    [{ id: 'cc', name: 'CC', cli: 'claude' }, { id: 'ds', name: 'DeepSeek' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 第一轮' });
  await settle();
  agent.saved.set('1', 'acp-old');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC /new' });
  await settle();
  assert.equal(agent.saved.has('1'), false, '/new deletes the saved ACP id for the room');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 新一轮' });
  await settle();
  assert.deepEqual(asks, [undefined, undefined], 'the turn after /new does not resume the saved id');
});

test('CLI member: a session that cannot be resumed is announced in the channel', async () => {
  const hub = makeHub();
  hub.store.bind('cc', 1, 'acp-old');
  cliMembers(hub, async (_text, _room, _onText, _onTool, opts) => {
    assert.equal(opts.resumeId, 'acp-old');
    opts.onSession({ sessionId: 'acp-new', lost: true });
    return '好';
  });
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 在吗' });
  await settle();
  assert.equal(hub.store.binding('cc', 1).session_id, 'acp-new');
  const notes = hub.store.page(1, undefined, 20).filter(m => m.author === 'system' && /这轮起是新会话/.test(m.text));
  assert.equal(notes.length, 1, 'one system message says the context was lost');
});

// #557: approvals of a DSH member's hidden Session show as permission cards in the channel.
/**
 * One tool call that needs approval in `agent`'s open turn, the way DSH asks:
 * tools pipeline → ApprovalService.request → (policy) → approval/request waterfall,
 * here with the collab answerer as the only listener before the fail-closed end.
 * Policy per permission preset: Default and Auto review ask; Full access never asks.
 */
const PRESET_POLICY = { default: 'ask', auto: 'ask', 'full-access': 'never' };
function askTool(dsh, members, agent, { preset = 'default', command = 'rm -rf build', signal, displayReason } = {}) {
  const callId = `call-${agent.session.events.length}`;
  dsh.emit(agent, 'tool/call', { turn: agent.turns, callId, name: 'bash', arguments: JSON.stringify({ command }) });
  const ran = [];
  const runTool = (outcome) => {
    if (outcome === 'allowed-once') ran.push(command);
    dsh.emit(agent, 'tool/result', { turn: agent.turns, message: { toolCallId: callId, isError: outcome !== 'allowed-once' } });
    return outcome;
  };
  if (PRESET_POLICY[preset] === 'never') return { ran, outcome: Promise.resolve(runTool('rejected')) };
  let fellThrough = false;
  const outcome = members.onApprovalRequest(
    { agent, toolName: 'bash', callId, reason: 'command needs to run outside the sandbox', displayReason, signal },
    () => { fellThrough = true; return Promise.resolve('unavailable'); },
  ).then(runTool);
  return { ran, outcome, fellThrough: () => fellThrough };
}
/**
 * Waits for a card's outcome, failing instead of hanging when no decision ever
 * comes (a lost signal, allowAll or expiry would otherwise leave the test pending).
 */
function decided(outcome, ms = 2000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no approval outcome within ${ms} ms`)), ms); });
  return Promise.race([outcome, timeout]).finally(() => clearTimeout(timer));
}

const cardsIn = (hub, room) => hub.store.page(room, undefined, 50).filter(m => m.card !== null && JSON.parse(m.card).kind === 'permission');
const cardState = (hub, id) => JSON.parse(hub.store.message(id).card).state;

/** @ the member in `room`, open the turn that takes the input, and return its agent. */
async function openTurn(hub, dsh, room, text = '@DeepSeek 清理一下') {
  hub.post(room, { authorKind: 'user', author: 'owner', name: '我', text });
  await settle();
  const agent = dsh.sessions.get(hub.store.binding('ds', room).session_id);
  dsh.turn(agent, [], null);
  return agent;
}

test('DSH approval #557: a localized displayReason shows as text, not [object Object]', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const agent = await openTurn(hub, dsh, 1);
  askTool(dsh, members, agent, { displayReason: { en: 'needs network access' } });
  await settle();
  const [card] = cardsIn(hub, 1);
  assert.match(card.text, /needs network access/);
  assert.doesNotMatch(card.text, /object Object/);
});

test('DSH approval #557: the card shows in the room that @-ed the member; 允许 lets the tool run and the turn reply', async () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'other');
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const agent = await openTurn(hub, dsh, 2);
  const { ran, outcome } = askTool(dsh, members, agent);
  await settle();
  assert.equal(cardsIn(hub, 1).length, 0, 'no card in a room that did not ask');
  const [card] = cardsIn(hub, 2);
  assert.ok(card, 'the card is in the room of the job');
  assert.equal(card.author, 'ds');
  assert.match(card.text, /权限请求\*\* bash/);
  assert.match(card.text, /rm -rf build/);
  assert.deepEqual(JSON.parse(card.card).actions.map(a => a.decision), ['allow', 'deny', 'allow_all']);

  hub.approvals.decide(card.id, 'allow');
  assert.equal(await decided(outcome), 'allowed-once');
  assert.deepEqual(ran, ['rm -rf build']);
  assert.equal(cardState(hub, card.id), 'allowed');
  dsh.emit(agent, 'assistant/message', { message: { content: [{ type: 'text', text: '清理完了' }] } });
  dsh.emit(agent, 'turn/end', { turn: agent.turns, reason: { kind: 'completed' } });
  await settle();
  assert.equal(hub.store.page(2, undefined, 1)[0].text, '清理完了');
  assert.throws(() => hub.approvals.decide(card.id, 'deny'), /已经处理/);
});

test('DSH approval #557: 拒绝 rejects the call and the tool does not run', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const agent = await openTurn(hub, dsh, 1);
  const { ran, outcome } = askTool(dsh, members, agent);
  await settle();
  const [card] = cardsIn(hub, 1);
  hub.approvals.decide(card.id, 'deny');
  assert.equal(await decided(outcome), 'rejected');
  assert.deepEqual(ran, []);
  assert.equal(cardState(hub, card.id), 'denied');
});

test('DSH approval #557: two rooms @ the same member, each card shows and is decided in its own room', async () => {
  const hub = makeHub();
  hub.store.ensureRoom(2, 'other');
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const a1 = await openTurn(hub, dsh, 1, '@DeepSeek 一号');
  const a2 = await openTurn(hub, dsh, 2, '@DeepSeek 二号');
  assert.notEqual(a1.session.id, a2.session.id);
  const t1 = askTool(dsh, members, a1, { command: 'make one' });
  const t2 = askTool(dsh, members, a2, { command: 'make two' });
  await settle();
  const [c1] = cardsIn(hub, 1);
  const [c2] = cardsIn(hub, 2);
  assert.equal(cardsIn(hub, 1).length, 1);
  assert.equal(cardsIn(hub, 2).length, 1);
  assert.match(c1.text, /make one/);
  assert.match(c2.text, /make two/);
  hub.approvals.decide(c2.id, 'deny');
  assert.equal(await decided(t2.outcome), 'rejected');
  assert.equal(cardState(hub, c1.id), 'pending', 'the other room is untouched');
  hub.approvals.decide(c1.id, 'allow');
  assert.equal(await decided(t1.outcome), 'allowed-once');
  assert.deepEqual([t1.ran, t2.ran], [['make one'], []]);
});

test('DSH approval #557: an owner text reply decides the card and starts no new ask; 允许所有 covers that Session only', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: "ds", name: "DeepSeek" }]);
  const agent = await openTurn(hub, dsh, 1);
  const first = askTool(dsh, members, agent);
  await settle();
  const jobs = hub.store.openJobs().length;
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 允许所有' });
  assert.equal(await decided(first.outcome), 'allowed-once');
  const [card] = cardsIn(hub, 1);
  assert.equal(cardState(hub, card.id), 'allowed_all');
  assert.equal(JSON.parse(hub.store.message(card.id).card).decided_by, 'text');
  await settle();
  assert.equal(hub.store.openJobs().length, jobs, 'the reply is an answer, not a new job');
  assert.equal(agent.prompts.length, 1);
  // Later asks in the same Session: allowed, no card.
  const later = askTool(dsh, members, agent, { command: 'ls' });
  assert.equal(await decided(later.outcome), 'allowed-once');
  assert.equal(cardsIn(hub, 1).length, 1);
});

test('DSH approval #557: a cancelled or recalled turn expires its card; a Web UI turn goes to the next answerer', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const agent = await openTurn(hub, dsh, 1);
  const abort = new AbortController();
  const cancelled = askTool(dsh, members, agent, { signal: abort.signal });
  await settle();
  const [c1] = cardsIn(hub, 1);
  abort.abort(); // DSH's stop button aborts the tool call's signal
  assert.equal(await decided(cancelled.outcome), 'cancelled');
  assert.deepEqual(cancelled.ran, []);
  assert.equal(cardState(hub, c1.id), 'expired');
  assert.throws(() => hub.approvals.decide(c1.id, 'allow'), /过期/);

  // The owner withdraws the @ while a card waits.
  const recalled = askTool(dsh, members, agent);
  await settle();
  const c2 = cardsIn(hub, 1).at(-1);
  const job = hub.store.openJobs()[0];
  members.recall(job.trigger_id);
  assert.equal(await decided(recalled.outcome), 'cancelled');
  assert.equal(cardState(hub, c2.id), 'expired');

  // A turn the channel did not start (DSH Web UI) is not ours to answer.
  dsh.turn(agent, [], null, { id: 'web-1', role: 'user', content: [] });
  const web = askTool(dsh, members, agent);
  assert.equal(await decided(web.outcome), 'unavailable');
  assert.equal(web.fellThrough(), true);
  assert.equal(cardsIn(hub, 1).length, 2);
});

test('DSH approval #557: after a restart an undecided card is expired on click, like a cloud-web prompt', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const agent = await openTurn(hub, dsh, 1);
  askTool(dsh, members, agent);
  await settle();
  const [card] = cardsIn(hub, 1);
  const hub2 = new Hub(hub.store, quiet);
  const again = fakeDsh();
  again.attach(hub2, [{ id: 'ds', name: 'DeepSeek' }]);
  assert.throws(() => hub2.approvals.decide(card.id, 'allow'), /过期/);
  assert.equal(cardState(hub2, card.id), 'expired');
});

test('DSH approval #557: Default and Auto review show a card when DSH asks; Full access shows none', async () => {
  for (const preset of ['default', 'auto', 'full-access']) {
    const hub = makeHub();
    const dsh = fakeDsh();
    const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek', permissionPreset: preset }]);
    const agent = await openTurn(hub, dsh, 1);
    const { outcome } = askTool(dsh, members, agent, { preset });
    await settle();
    const cards = cardsIn(hub, 1);
    if (preset === 'full-access') {
      assert.equal(cards.length, 0, 'Full access: no card');
      assert.equal(await decided(outcome), 'rejected');
      continue;
    }
    assert.equal(cards.length, 1, `${preset}: one card`);
    hub.approvals.decide(cards[0].id, 'allow');
    assert.equal(await decided(outcome), 'allowed-once');
  }
});

test('DSH approval #557: another plugin answering approval/request first does not take a DSH member\'s ask', async () => {
  const hub = makeHub();
  const dsh = fakeDsh();
  const members = dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
  const agent = await openTurn(hub, dsh, 1);
  // A waterfall like Cordis: prepended listeners run first, each may call next().
  const listeners = [];
  const ctx = { on(name, fn, { prepend = false } = {}) { assert.equal(name, 'approval/request'); prepend ? listeners.unshift(fn) : listeners.push(fn); } };
  const run = (request, i = 0) => (i < listeners.length ? listeners[i](request, () => run(request, i + 1)) : Promise.resolve('unavailable'));
  // An auto-review style answerer registered before the collab plugin answers every ask itself.
  ctx.on('approval/request', async () => 'allowed-once');
  installApprovalAnswerer(ctx, members);
  const outcome = run({ agent, toolName: 'bash', callId: 'c1', reason: 'outside the sandbox' });
  await settle();
  const [card] = cardsIn(hub, 1);
  assert.ok(card, 'the DSH member\'s card still shows');
  hub.approvals.decide(card.id, 'deny');
  assert.equal(await decided(outcome), 'rejected');
});

// Block B: regressions for member media and durable one-shot wake routing.
import { Attachments, attachmentBlocks, nativeAttachmentBlocks, MAX_IMAGE_BYTES } from './attachments.mjs';
import { Later, registerLater } from './later.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('block B: native and CLI members receive image and file blocks via shared wire policy', async () => {
  const files = new Attachments(mkdtempSync(join(tmpdir(), 'blockb-media-')));
  const attachments = files.save([
    { name: 'photo.png', mime: 'image/png', data: Buffer.from('png').toString('base64') },
    { name: 'notes.txt', mime: 'text/plain', data: Buffer.from('hello').toString('base64') },
    { name: 'large.png', mime: 'image/png', data: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64') },
    { name: 'vector.svg', mime: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64') },
  ]);
  const hub = makeHub();
  const captured = [];
  const members = cliMembers(hub, async (...args) => { captured.push(args); return 'received'; });
  members.rt.files = files;
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC check', attachments });
  await settle();
  assert.deepEqual(captured[0][4].attachments.map(b => b.type), ['image', 'resource', 'resource', 'resource']);
  assert.equal(captured[0][4].attachments[1].resource.blob, Buffer.from('hello').toString('base64'));
  const native = fakeDsh();
  const nativeHub = makeHub();
  const ds = native.attach(nativeHub, [{ id: 'native', name: 'Native' }]);
  ds.rt.files = files;
  native.ctx.attachments = {
    admitEncodedFile: async f => ({ attachmentId: f.name, name: f.name }),
    admitPromptContent: async parts => parts.map(b => b.type === 'image' ? { type: 'image', attachment: { attachmentId: 'image' } } : b),
  };
  nativeHub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@Native check', attachments });
  await settle();
  const agent = native.sessions.get(native.made[0]);
  assert.deepEqual(agent.prompts[0].content.slice(-4).map(b => b.type), ['image', 'file', 'file', 'file']);
  native.turn(agent, ['received']);
  await settle();
  await ds.close();
});

test('block B: DSH refusing one image of a batch drops only that image and tells the channel', async () => {
  const files = new Attachments(mkdtempSync(join(tmpdir(), 'blockb-partial-')));
  const attachments = files.save([
    { name: 'huge.png', mime: 'image/png', data: Buffer.from('huge').toString('base64') },
    { name: 'small.png', mime: 'image/png', data: Buffer.from('small').toString('base64') },
  ]);
  const native = fakeDsh();
  const hub = makeHub();
  const ds = native.attach(hub, [{ id: 'native', name: 'Native' }]);
  ds.rt.files = files;
  const pixelLimit = 'Image exceeds the configured decoded-pixel limit.';
  native.ctx.attachments = {
    admitEncodedFile: async f => ({ attachmentId: f.name, name: f.name }),
    admitPromptContent: async parts => {
      if (parts.some(p => p.type === 'image' && Buffer.from(p.data, 'base64').toString() === 'huge')) throw new Error(pixelLimit);
      return parts.map(p => ({ type: 'image', attachment: { attachmentId: Buffer.from(p.data, 'base64').toString() } }));
    },
  };
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@Native check', attachments });
  await settle();
  const agent = native.sessions.get(native.made[0]);
  assert.equal(agent.prompts.length, 1);
  const content = agent.prompts[0].content;
  assert.match(content[0].text, /@Native check/);
  assert.match(content[0].text, /huge\.png: 附件未送达（/);
  assert.doesNotMatch(content[0].text, /small\.png: 附件未送达/);
  assert.deepEqual(content.slice(1), [{ type: 'image', attachment: { attachmentId: 'small' } }]);
  const note = hub.store.page(1, undefined, 20).find(m => m.author_kind === 'system' && /附件没送到/.test(m.text));
  assert.ok(note, 'channel shows a system note for the dropped attachment');
  assert.match(note.text, /Native/);
  assert.match(note.text, /huge\.png（图片太大，超过像素上限）/);
  assert.doesNotMatch(note.text, /exceeds/, 'the channel note is in Chinese, not DSH\'s English message');
  assert.doesNotMatch(note.text, /small\.png/);
  native.turn(agent, ['received']);
  await settle();
  assert.ok(hub.store.page(1, undefined, 20).some(m => m.text === 'received'));
  const trigger = hub.store.page(1, undefined, 20).find(m => m.text === '@Native check');
  assert.ok(hub.store.binding('native', 1).context_cursor >= trigger.id, 'cursor advanced past the trigger');
  assert.equal(agent.prompts.length, 1, 'the system note does not start another turn');
  await ds.close();
});

test('block B: DSH rejecting an image batch still delivers the text and advances', async () => {
  const files = new Attachments(mkdtempSync(join(tmpdir(), 'blockb-reject-')));
  const attachments = files.save([{ name: 'a.png', mime: 'image/png', data: Buffer.from('png').toString('base64') }]);
  const native = fakeDsh();
  const hub = makeHub();
  const ds = native.attach(hub, [{ id: 'native', name: 'Native' }]);
  ds.rt.files = files;
  native.ctx.attachments = {
    admitEncodedFile: async f => ({ attachmentId: f.name, name: f.name }),
    admitPromptContent: async () => { throw new Error('too many images'); },
  };
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@Native check', attachments });
  await settle();
  const agent = native.sessions.get(native.made[0]);
  assert.equal(agent.prompts.length, 1);
  assert.match(agent.prompts[0].content[0].text, /a\.png: 附件未送达（/);
  assert.equal(agent.prompts[0].content.length, 1);
  native.turn(agent, ['received']);
  await settle();
  assert.ok(hub.store.page(1, undefined, 20).some(m => m.text === 'received'));
  await ds.close();
});

test('block B: DSH batch limit keeps the images that fit and notes the rest once', async () => {
  const files = new Attachments(mkdtempSync(join(tmpdir(), 'blockb-limit-')));
  const attachments = files.save(['a', 'b', 'c'].map(n => ({ name: `${n}.png`, mime: 'image/png', data: Buffer.from(n).toString('base64') })));
  const native = fakeDsh();
  const hub = makeHub();
  const ds = native.attach(hub, [{ id: 'native', name: 'Native' }]);
  ds.rt.files = files;
  native.ctx.attachments = {
    admitEncodedFile: async f => ({ attachmentId: f.name, name: f.name }),
    admitPromptContent: async parts => {
      if (parts.length > 1) throw new Error('too many images');
      return parts.map(p => ({ type: 'image', attachment: { attachmentId: Buffer.from(p.data, 'base64').toString() } }));
    },
  };
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@Native check', attachments });
  await settle();
  const agent = native.sessions.get(native.made[0]);
  const content = agent.prompts[0].content;
  assert.deepEqual(content.slice(1), [{ type: 'image', attachment: { attachmentId: 'a' } }]);
  assert.match(content[0].text, /b\.png: 附件未送达（/);
  assert.match(content[0].text, /c\.png: 附件未送达（/);
  const notes = hub.store.page(1, undefined, 20).filter(m => m.author_kind === 'system' && /附件没送到/.test(m.text));
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /b\.png（too many images）；c\.png（too many images）/);
  assert.doesNotMatch(notes[0].text, /a\.png/);
  await ds.close();
});

test('block B: DSH refusing every image of a batch delivers the text alone and notes all of them', async () => {
  const files = new Attachments(mkdtempSync(join(tmpdir(), 'blockb-allreject-')));
  const attachments = files.save(['a', 'b'].map(n => ({ name: `${n}.png`, mime: 'image/png', data: Buffer.from(n).toString('base64') })));
  const native = fakeDsh();
  const hub = makeHub();
  const ds = native.attach(hub, [{ id: 'native', name: 'Native' }]);
  ds.rt.files = files;
  native.ctx.attachments = {
    admitEncodedFile: async f => ({ attachmentId: f.name, name: f.name }),
    admitPromptContent: async () => { throw new Error('pixel limit'); },
  };
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@Native check', attachments });
  await settle();
  const agent = native.sessions.get(native.made[0]);
  assert.equal(agent.prompts[0].content.length, 1);
  const notes = hub.store.page(1, undefined, 20).filter(m => m.author_kind === 'system' && /附件没送到/.test(m.text));
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /a\.png（pixel limit）；b\.png（pixel limit）/);
  native.turn(agent, ['received']);
  await settle();
  assert.ok(hub.store.page(1, undefined, 20).some(m => m.text === 'received'));
  await ds.close();
});

test('block B: later survives restart, keeps offline wakes and delivers once to each member kind', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'blockb-later-')), 'collab.sqlite3');
  let store = new Store(path); store.ensureRoom(1, 'general');
  let hub = makeHubFrom(store);
  let now = 1000;
  let later = new Later(hub, path, () => false, { now: () => now, start: false });
  for (const member of ['native', 'cli', 'bridge']) registerLater(store.db, { member, room: 1, delay: '2s', title: 'check', todo: 'read build log' }, now);
  assert.throws(() => registerLater(store.db, { member: 'cli', room: 1, delay: '0m', title: 'check', todo: 'log' }), /later requires/);
  later.tick();
  assert.equal(store.page(1, undefined, 20).length, 3, 'registration visible before wake');
  later.close(); store.close();
  store = new Store(path); hub = makeHubFrom(store);
  const received = [];
  let online = false;
  now = 4000;
  later = new Later(hub, path, (id, message) => { if (!online) return false; received.push([id, message]); return true; }, { now: () => now, start: false });
  later.tick();
  const pending = store.db.prepare('SELECT message_id FROM member_later').all();
  assert.equal(received.length, 0);
  online = true; later.tick(); later.tick();
  assert.deepEqual(received.map(([id]) => id), ['native', 'cli', 'bridge']);
  assert.deepEqual(received.map(([, m]) => m.id), pending.map(r => r.message_id));
  assert.ok(received.every(([, m]) => m.room_id === 1 && m.text.includes('read build log')));
  assert.equal(store.page(1, undefined, 20).length, 6);
  later.close(); store.close();
});

import { CliMember } from './cli-member.mjs';
import { laterRoute } from './plugin.mjs';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync } from 'node:fs';

test('block B: ACP prompt actually includes image/resource blocks', async () => {
  const member = new CliMember({ cli: 'claude', cwd: '/tmp' });
  member._session = async () => ({ sessionId: 'test', first: false });
  let prompt;
  member.conn = { prompt: async value => { prompt = value; member.buffers.set('test', 'done'); } };
  const media = [{ type: 'image', mimeType: 'image/png', data: 'cG5n' }, { type: 'resource', resource: { uri: 'attachment:///a.txt', mimeType: 'text/plain', blob: 'aGk=' } }];
  assert.equal(await member.ask('read', 'room', undefined, undefined, { attachments: media }), 'done');
  assert.deepEqual(prompt.prompt, [{ type: 'text', text: 'read' }, ...media]);
});

test('block B: local later command registers through the ticketed HTTP route, not the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blockb-command-'));
  const path = join(dir, 'collab.sqlite3');
  const store = new Store(path); store.ensureRoom(1, 'general');
  const hub = makeHubFrom(store); hub.setMember({ id: 'cli', name: 'CLI', kind: 'dsh', online: true });
  const woke = [];
  let now = Date.now();
  const later = new Later(hub, path, (id, m) => { woke.push([id, m]); return true; }, { now: () => now, start: false });
  assert.equal(statSync(join(dir, 'later.key')).mode & 0o777, 0o600, 'key file is private');
  const server = createServer((req, res) => laterRoute(req, res, new URL(req.url, 'http://x'), { hub, later, owner: () => false, gateway: { authorized: () => false } }) ?? (res.headersSent || (res.writeHead(404), res.end('{}'))));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
  later.origin = `http://127.0.0.1:${server.address().port}`;
  assert.match(later.instructions('cli', 1), new RegExp(later.ticket('cli', 1).replace(/[.]/g, '\\.')));
  const run = args => new Promise(resolve => { const child = spawn(process.execPath, [new URL('./later.mjs', import.meta.url).pathname, ...args]); let out = ''; child.stdout.on('data', d => { out += d; }); child.on('close', status => resolve({ status, out })); });
  assert.notEqual((await run([later.origin, 'forged.ticket', '1s', 'check', 'read results'])).status, 0);
  assert.notEqual((await run([later.origin, later.ticket('cli', 1).slice(0, -2) + 'xx', '1s', 'check', 'read results'])).status, 0, 'tampered ticket rejected');
  const result = await run([later.origin, later.ticket('cli', 1), '1s', 'check', 'read results']);
  assert.equal(result.status, 0);
  const { reminder } = JSON.parse(result.out);
  assert.equal(reminder.member_id, 'cli'); assert.equal(reminder.room_id, 1);
  now = reminder.due_at; later.tick();
  assert.equal(woke.length, 1); assert.equal(woke[0][0], 'cli'); assert.equal(woke[0][1].room_id, 1);
  assert.match(woke[0][1].text, /read results/);
  } finally { server.close(); later.close(); store.close(); }
});

test('block B: later API only accepts a ticket bound to the same member and room', async () => {
  const hub = makeHub(); hub.store.ensureRoom(2, 'other');
  for (const id of ['a', 'b']) hub.setMember({ id, name: id, kind: 'dsh', online: true });
  let now = 1000;
  const woke = [];
  const later = new Later(hub, ':memory:', (id, m) => { woke.push([id, m.room_id]); return true; }, { now: () => now, start: false });
  const request = async (ticket, body, room = 1) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST';
    req.headers = ticket === undefined ? {} : { 'x-later-ticket': ticket };
    const res = { writeHead(status) { this.status = status; }, end(data) { this.body = JSON.parse(data); } };
    // Owner session and shared bot token are both present: neither may register on its own.
    await laterRoute(req, res, new URL(`http://localhost/collab/api/rooms/${room}/later`), { hub, later, owner: () => true, gateway: { authorized: () => true } });
    return res;
  };
  const body = { delay: '1s', title: 'check', todo: 'read log' };
  const ticketA = later.ticket('a', 1);
  assert.equal((await request(undefined, { ...body, member: 'a' })).status, 401, 'no ticket');
  assert.equal((await request(ticketA.slice(0, -2) + 'xx', body)).status, 401, 'tampered ticket');
  assert.equal((await request(ticketA, { ...body, member: 'b' })).status, 403, "A's ticket cannot register B");
  assert.equal((await request(ticketA, body, 2)).status, 403, "A's ticket cannot register another room");
  assert.equal((await request(ticketA, { ...body, room: 2 })).status, 403, 'body room must match the ticket');
  assert.equal((await request(later.ticket('missing', 1), body)).status, 404);
  const ok = await request(ticketA, body);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.reminder.member_id, 'a'); assert.equal(ok.body.reminder.room_id, 1);
  now = ok.body.reminder.due_at; later.tick();
  assert.deepEqual(woke, [['a', 1]], 'only A wakes, in the original room');
  later.close();
});

test('block B: due follow-up enters native, CLI and cloud-web member routing in the original room', async () => {
  const hub = makeHub();
  const native = fakeDsh();
  const members = native.attach(hub, [{ id: 'native', name: 'Native' }, { id: 'cli', name: 'CLI', cli: 'claude' }]);
  const cliPrompts = [];
  members.rt.createCliMember = () => ({ ask: async text => { cliPrompts.push(text); return 'checked'; }, close() {} });
  const gateway = new CloudWebGateway(hub, { token: 'secret', logger: quiet });
  const ws = connect(gateway, 'token=secret&bot=bridge&name=Bridge');
  let now = 1000;
  const later = new Later(hub, ':memory:', (id, msg) => members.nudge(id, msg) || gateway.nudge(id, msg), { now: () => now, start: false });
  for (const member of ['native', 'cli', 'bridge']) registerLater(hub.store.db, { member, room: 1, delay: '1s', title: 'results', todo: 'read log now' }, now);
  now = 3000; later.tick(); later.tick(); await settle();
  assert.equal(cliPrompts.length, 1); assert.match(cliPrompts[0], /read log now/);
  const agent = native.sessions.get(native.made[0]);
  assert.equal(agent.prompts.length, 1); assert.match(agent.prompts[0].content[0].text, /read log now/);
  const frames = ws.of('message').filter(f => f.content.includes('read log now'));
  assert.equal(frames.length, 1); assert.equal(frames[0].chat_id, 'room-1'); assert.equal(frames[0].mentioned, true);
  native.turn(agent, ['checked']); await settle();
  later.close(); gateway.closeAll(); await members.close();
});

import { writeFileSync as writeKeyFile, readFileSync as readKeyFile } from 'node:fs';
test('later: empty or short key file is regenerated to 32 bytes; old tickets stop verifying', () => {
  for (const bad of ['', 'abcd']) {
    const dir = mkdtempSync(join(tmpdir(), 'later-key-'));
    const path = join(dir, 'collab.sqlite3'); const keyFile = join(dir, 'later.key');
    const store = new Store(path); store.ensureRoom(1, 'general');
    const hub = makeHubFrom(store);
    const first = new Later(hub, path, () => false, { start: false });
    const oldTicket = first.ticket('cli', 1);
    assert.deepEqual(first.verify(oldTicket), { member: 'cli', room: 1 });
    writeKeyFile(keyFile, bad);
    const second = new Later(hub, path, () => false, { start: false });
    assert.equal(second.key.length, 32, `regenerated from ${JSON.stringify(bad)}`);
    assert.equal(Buffer.from(readKeyFile(keyFile, 'utf8').trim(), 'hex').length, 32);
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
    assert.equal(second.verify(oldTicket), undefined, 'old ticket no longer verifies');
    const forged = `${oldTicket.split('.')[0]}.${createHmacForTest(Buffer.alloc(0), oldTicket.split('.')[0])}`;
    assert.equal(second.verify(forged), undefined, 'empty-key forgery rejected');
    assert.deepEqual(second.verify(second.ticket('cli', 1)), { member: 'cli', room: 1 }, 'new ticket verifies');
    assert.deepEqual(new Later(hub, path, () => false, { start: false }).verify(second.ticket('cli', 1)), { member: 'cli', room: 1 }, 'key persists');
  }
});
import { createHmac as createHmacTest } from 'node:crypto';
function createHmacForTest(key, payload) { return createHmacTest('sha256', key).update(payload).digest('base64url'); }

// CLI member tool approval follows the member's DSH permission preset (cli-member.mjs presetDecision).
const ACP_PERMISSION = {
  sessionId: 's1',
  toolCall: { toolCallId: 't1', title: 'Bash', rawInput: { command: 'rm -rf build' } },
  options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }],
};

function cliPermissionRun(hub, permissionPreset, outcomes) {
  const dsh = fakeDsh();
  const agent = {
    async ask(_text, _room, _onText, _onTool, opts) { outcomes.push(await opts.onPermission(ACP_PERMISSION)); return '好'; },
    close() {},
  };
  return new DshMembers(hub, { ctx: dsh.ctx, createUserMessage: m => m, createCliMember: () => agent, workspacePath: '/w', logger: quiet },
    [{ id: 'cc', name: 'CC', cli: 'claude', ...(permissionPreset ? { permissionPreset } : {}) }]);
}
const permCards = hub => hub.store.page(1, undefined, 20).filter(m => m.card !== null && JSON.parse(m.card).kind === 'permission');

test('CLI member, Full access preset: tool call allowed at once, no card', async () => {
  const hub = makeHub();
  const outcomes = [];
  cliPermissionRun(hub, 'danger-full-access', outcomes);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 清一下' });
  await settle();
  assert.deepEqual(outcomes, [{ outcome: 'selected', optionId: 'allow-once' }]);
  assert.equal(permCards(hub).length, 0);
});

test('CLI member, Read Only preset: tool call refused, no card', async () => {
  const hub = makeHub();
  const outcomes = [];
  cliPermissionRun(hub, 'read-only', outcomes);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 清一下' });
  await settle();
  assert.deepEqual(outcomes, [{ outcome: 'selected', optionId: 'reject-once' }]);
  assert.equal(permCards(hub).length, 0);
});

for (const [decision, optionId] of [['allow', 'allow-once'], ['deny', 'reject-once']]) {
  test(`CLI member, default Workspace Write preset: card in the room, ${decision} goes back to ACP as ${optionId}`, async () => {
    const hub = makeHub();
    const outcomes = [];
    cliPermissionRun(hub, undefined, outcomes);
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 清一下' });
    await settle();
    const [card] = permCards(hub);
    assert.ok(card, 'a permission card is posted');
    assert.equal(card.author, 'cc');
    assert.match(card.text, /权限请求\*\* Bash/);
    assert.match(card.text, /rm -rf build/);
    assert.deepEqual(JSON.parse(card.card).actions.map(a => a.decision), ['allow', 'deny'], 'only the buttons ACP offered');
    assert.deepEqual(outcomes, []);
    hub.approvals.decide(card.id, decision);
    await settle();
    assert.deepEqual(outcomes, [{ outcome: 'selected', optionId }]);
  });
}

test('CLI member without allow_always: typed 允许所有 goes back to ACP as allow-once and the card shows allowed', async () => {
  const hub = makeHub();
  const outcomes = [];
  cliPermissionRun(hub, undefined, outcomes);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 清一下' });
  await settle();
  const [card] = permCards(hub);
  assert.ok(card, 'a permission card is posted');
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '允许所有' });
  await settle();
  assert.deepEqual(outcomes, [{ outcome: 'selected', optionId: 'allow-once' }]);
  const state = JSON.parse(hub.store.message(card.id).card).state;
  assert.equal(state, 'allowed', 'card shows what ACP got, not 已允许所有');
});

test('CLI member: after 允许所有 the next command in the same session is allowed without a card', async () => {
  const hub = makeHub();
  const outcomes = [];
  const request = (id, command) => ({
    sessionId: 's1',
    toolCall: { toolCallId: id, title: 'Bash', rawInput: { command } },
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
    ],
  });
  const dsh = fakeDsh();
  let turn = 0;
  const agent = {
    async ask(_text, _room, _onText, _onTool, opts) {
      turn += 1;
      outcomes.push(await opts.onPermission(request(`t${turn}a`, `ls ${turn}`)));
      outcomes.push(await opts.onPermission(request(`t${turn}b`, `git status ${turn}`)));
      return '好';
    },
    close() {},
  };
  new DshMembers(hub, { ctx: dsh.ctx, createUserMessage: m => m, createCliMember: () => agent, workspacePath: '/w', logger: quiet },
    [{ id: 'cc', name: 'CC', cli: 'claude' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 跑一下' });
  await settle();
  const [card] = permCards(hub);
  assert.ok(card, 'the first command asks');
  assert.deepEqual(JSON.parse(card.card).actions.map(a => a.decision), ['allow', 'deny', 'allow_all']);
  hub.approvals.decide(card.id, 'allow_all');
  await settle();
  assert.equal(permCards(hub).length, 1, 'the next command in the same turn posts no card');
  assert.deepEqual(outcomes, [{ outcome: 'selected', optionId: 'allow-always' }, { outcome: 'selected', optionId: 'allow-once' }]);
  hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 再跑一下' });
  await settle();
  assert.equal(permCards(hub).length, 1, 'a later turn of the member in this room posts no card either');
  assert.deepEqual(outcomes.slice(2), [{ outcome: 'selected', optionId: 'allow-once' }, { outcome: 'selected', optionId: 'allow-once' }]);
});

test('attachments: undelivered reasons are shown in Chinese by DSH error code, unknown ones stay as-is', async () => {
  const { undeliveredReasonZh } = await import('./attachments.mjs');
  assert.equal(undeliveredReasonZh({ reason: 'whatever', code: 'IMAGE_TOO_MANY_PIXELS' }), '图片太大，超过像素上限');
  assert.equal(undeliveredReasonZh({ reason: 'Image exceeds the configured byte limit.' }), '图片文件太大，超过大小上限');
  assert.equal(undeliveredReasonZh({ reason: 'Unsupported or malformed image data.', code: 'INVALID_IMAGE' }), '图片格式不支持或已损坏');
  assert.equal(undeliveredReasonZh({ reason: 'Image exceeds the configured per-side pixel limit.' }), '图片太长或太宽，超过单边像素上限');
  assert.equal(undeliveredReasonZh({ reason: 'something new' }), 'something new');
});

// #597 K11: DSH-native members get the gate's /context (wiki pages, task board) each turn.
async function fakeGate(handler) {
  const { createServer } = await import('node:http');
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      calls.push({ path: req.url, body: JSON.parse(body || '{}') });
      const out = handler(calls.at(-1));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { calls, port: server.address().port, close: () => new Promise(r => server.close(r)) };
}
const until = async (f) => { for (let i = 0; i < 400 && !f(); i++) await new Promise(r => setTimeout(r, 5)); };
const BOARD = { path: '【任务板 abc123】', desc: '谁手上有哪件事、做在哪\n#7 修登录 · 龙娘' };

test('DSH member: each turn carries the gate wiki and task board, a page only once per conversation', async () => {
  const gate = await fakeGate(({ body }) => ({ wiki: [BOARD, { path: '~/wiki/a.md', desc: body.text.includes('部署') ? '部署步骤' : 'a' }] }));
  process.env.GATE_PORT = String(gate.port);
  try {
    const hub = makeHub();
    const dsh = fakeDsh();
    dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 怎么部署' });
    await until(() => dsh.made.length && dsh.sessions.get(dsh.made[0]).prompts.length === 1);
    const agent = dsh.sessions.get(dsh.made[0]);
    const first = agent.prompts[0].content[0].text;
    assert.match(first, /（可能相关的 wiki 页，需要时去读）/);
    assert.match(first, /- ~\/wiki\/a\.md — 部署步骤/);
    assert.match(first, /- 【任务板 abc123】 — 谁手上有哪件事、做在哪\n#7 修登录 · 龙娘/);
    assert.ok(first.indexOf('wiki 页') < first.indexOf('【我】@DeepSeek'), 'the block comes before the channel messages');
    assert.deepEqual(gate.calls[0].body, { key: 'dsh:ds:1', text: '@DeepSeek 怎么部署', bot: 'dsh:ds' });
    dsh.turn(agent, ['好']);
    await until(() => hub.store.job(1).state === 'done');
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 再说一遍' });
    await until(() => agent.prompts.length === 2);
    const second = agent.prompts[1].content[0].text;
    assert.equal(gate.calls.length, 2, 'the gate is asked every turn');
    assert.doesNotMatch(second, /wiki 页|任务板/, 'pages already given are not given again');
  } finally {
    delete process.env.GATE_PORT;
    await gate.close();
  }
});

test('CLI member: the gate block goes into the prompt; a changed board goes out again', async () => {
  let tag = 'aaa111';
  const gate = await fakeGate(() => ({ wiki: [{ ...BOARD, path: `【任务板 ${tag}】` }] }));
  process.env.GATE_PORT = String(gate.port);
  try {
    const hub = makeHub();
    const prompts = [];
    cliMembers(hub, async (text) => { prompts.push(text); return '收到'; });
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 任务板上有什么' });
    await until(() => hub.store.job(1)?.state === 'done');
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 还有吗' });
    await until(() => hub.store.job(2)?.state === 'done');
    tag = 'bbb222';
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 现在呢' });
    await until(() => hub.store.job(3)?.state === 'done');
    assert.match(prompts[0], /【任务板 aaa111】 — .*\n#7 修登录 · 龙娘/);
    assert.doesNotMatch(prompts[1], /任务板/);
    assert.match(prompts[2], /【任务板 bbb222】/);
  } finally {
    delete process.env.GATE_PORT;
    await gate.close();
  }
});

test('DSH member: gate down or slow, the turn goes out as before', async () => {
  const { createServer } = await import('node:net');
  const dead = createServer(); await new Promise(r => dead.listen(0, '127.0.0.1', r));
  const port = dead.address().port; await new Promise(r => dead.close(r));
  process.env.GATE_PORT = String(port);
  try {
    const hub = makeHub();
    const prompts = [];
    cliMembers(hub, async (text) => { prompts.push(text); return '照常回'; });
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 在吗' });
    await until(() => hub.store.job(1)?.state === 'done');
    assert.equal(hub.store.job(1).state, 'done');
    assert.doesNotMatch(prompts[0], /wiki 页/);
    assert.equal(hub.store.page(1, undefined, 1)[0].text, '照常回');
  } finally {
    delete process.env.GATE_PORT;
  }
  const { GateContext } = await import('./gate-context.mjs');
  const slow = new GateContext({ port: '1', timeoutMs: 20, fetch: (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason))) });
  const t0 = Date.now();
  assert.equal((await slow.turn({ member: 'ds', room: 1, text: 'x' })).block, '');
  assert.ok(Date.now() - t0 < 1000, 'a hung gate is given up on after the timeout');
});

test('DSH member: its own MEMORY.md goes into the first turn of a conversation only', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const data = mkdtempSync(join(tmpdir(), 'collab-mem-'));
  mkdirSync(join(data, 'roles', 'ds', 'wiki'), { recursive: true });
  writeFileSync(join(data, 'roles', 'ds', 'wiki', 'MEMORY.md'), '- [projects](projects/README.md) — 部署记录\n');
  process.env.BOTHOUSE_DATA_DIR = data;
  try {
    const hub = makeHub();
    const dsh = fakeDsh();
    dsh.attach(hub, [{ id: 'ds', name: 'DeepSeek' }]);
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 在吗' });
    await until(() => dsh.made.length && dsh.sessions.get(dsh.made[0]).prompts.length === 1);
    const agent = dsh.sessions.get(dsh.made[0]);
    const first = agent.prompts[0].content[0].text;
    assert.ok(first.includes(`（你的记忆 wiki 目录页 ${join(data, 'roles', 'ds', 'wiki', 'MEMORY.md')}，新会话系统自动附上，不用回应）\n- [projects](projects/README.md) — 部署记录`), first);
    assert.ok(first.indexOf('你的记忆') < first.indexOf('【我】@DeepSeek'), 'the block comes before the channel messages');
    dsh.turn(agent, ['在']);
    await until(() => hub.store.job(1).state === 'done');
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@DeepSeek 再说一遍' });
    await until(() => agent.prompts.length === 2);
    assert.doesNotMatch(agent.prompts[1].content[0].text, /你的记忆/, 'the second turn does not carry it again');
  } finally {
    delete process.env.BOTHOUSE_DATA_DIR;
  }
});

test('CLI member: its own MEMORY.md on the first turn only; no wiki, no block', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { MemoryIndex } = await import('./memory-index.mjs');
  const data = mkdtempSync(join(tmpdir(), 'collab-mem-'));
  mkdirSync(join(data, 'roles', 'm-ab12cd', 'wiki'), { recursive: true });
  writeFileSync(join(data, 'roles', 'm-ab12cd', 'wiki', 'MEMORY.md'), '- [a](a/README.md) — 甲\n');
  const idx = new MemoryIndex({ dataDir: data, home: data });
  const one = idx.turn({ member: 'm-ab12cd', room: 1 });
  assert.equal(one.block, '（你的记忆 wiki 目录页 ~/roles/m-ab12cd/wiki/MEMORY.md，新会话系统自动附上，不用回应）\n- [a](a/README.md) — 甲');
  assert.notEqual(idx.turn({ member: 'm-ab12cd', room: 1 }).block, '', 'not given until the prompt went out');
  one.commit();
  assert.equal(idx.turn({ member: 'm-ab12cd', room: 1 }).block, '');
  assert.notEqual(idx.turn({ member: 'm-ab12cd', room: 2 }).block, '', 'another room is another conversation');
  assert.notEqual(idx.turn({ member: 'm-ab12cd', room: 1, session: 's2' }).block, '', 'a new session is a fresh context');
  idx.resetRoom(1);
  assert.notEqual(idx.turn({ member: 'm-ab12cd', room: 1 }).block, '', 'a released workspace starts over');
  assert.equal(idx.turn({ member: 'nobody', room: 1 }).block, '');
  assert.equal(new MemoryIndex({ dataDir: '' }).turn({ member: 'm-ab12cd', room: 1 }).block, '');
});

test('CLI member: after /new the fresh context gets its MEMORY.md and the task board again', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const data = mkdtempSync(join(tmpdir(), 'collab-mem-'));
  mkdirSync(join(data, 'roles', 'cc', 'wiki'), { recursive: true });
  writeFileSync(join(data, 'roles', 'cc', 'wiki', 'MEMORY.md'), '- [a](a/README.md) — 甲\n');
  const gate = await fakeGate(() => ({ wiki: [{ ...BOARD, path: '【任务板 aaa111】' }] }));
  process.env.BOTHOUSE_DATA_DIR = data;
  process.env.GATE_PORT = String(gate.port);
  try {
    const hub = makeHub();
    const prompts = [];
    cliMembers(hub, async (text, _room, _onText, _onTool, opts) => {
      prompts.push(text);
      opts.onSession({ sessionId: `acp-${prompts.length}`, lost: false });
      return '好';
    });
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 第一轮' });
    await until(() => prompts.length === 1 && hub.store.job(1)?.state === 'done');
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 第二轮' });
    await until(() => prompts.length === 2);
    await settle();
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC /new' });
    await settle();
    hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: '@CC 新一轮' });
    await until(() => prompts.length === 3);
    assert.match(prompts[0], /你的记忆/);
    assert.match(prompts[0], /【任务板 aaa111】/);
    assert.doesNotMatch(prompts[1], /你的记忆|任务板/, 'same context: not again');
    assert.match(prompts[2], /你的记忆/, '/new: MEMORY.md again');
    assert.match(prompts[2], /【任务板 aaa111】/, '/new: the unchanged board again');
  } finally {
    delete process.env.BOTHOUSE_DATA_DIR;
    delete process.env.GATE_PORT;
    await gate.close();
  }
});

test('CLI member: a session that could not be resumed gets its MEMORY.md and the task board again next turn', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const data = mkdtempSync(join(tmpdir(), 'collab-mem-'));
  mkdirSync(join(data, 'roles', 'cc', 'wiki'), { recursive: true });
  writeFileSync(join(data, 'roles', 'cc', 'wiki', 'MEMORY.md'), '- [a](a/README.md) — 甲\n');
  const gate = await fakeGate(() => ({ wiki: [{ ...BOARD, path: '【任务板 aaa111】' }] }));
  process.env.BOTHOUSE_DATA_DIR = data;
  process.env.GATE_PORT = String(gate.port);
  try {
    const hub = makeHub();
    const prompts = [];
    cliMembers(hub, async (text, _room, _onText, _onTool, opts) => {
      prompts.push(text);
      // the second turn's resume fails: the CLI is in a new session
      opts.onSession({ sessionId: `acp-${prompts.length}`, lost: prompts.length === 2 });
      return '好';
    });
    for (const [i, t] of ['第一轮', '第二轮', '第三轮', '第四轮'].entries()) {
      hub.post(1, { authorKind: 'user', author: 'owner', name: '我', text: `@CC ${t}` });
      await until(() => prompts.length === i + 1);
      await settle();
    }
    assert.match(prompts[0], /你的记忆/);
    assert.doesNotMatch(prompts[1], /你的记忆|任务板/, 'same context so far: not again');
    assert.match(prompts[2], /你的记忆/, 'session lost: MEMORY.md again');
    assert.match(prompts[2], /【任务板 aaa111】/, 'session lost: the unchanged board again');
    assert.doesNotMatch(prompts[3], /你的记忆|任务板/, 'given to the new session: not again');
  } finally {
    delete process.env.BOTHOUSE_DATA_DIR;
    delete process.env.GATE_PORT;
    await gate.close();
  }
});

// #597 G24: a DSH primary opens a workspace with its later ticket; the route opens the task and wakes the owner.
async function g24Setup(members = ['ju']) {
  const { workspacesRoute } = await import('./plugin.mjs');
  const hub = makeHub(); hub.store.ensureRoom(2, 'other');
  for (const id of members) hub.setMember({ id, name: id, kind: 'dsh', online: true });
  let lead = members[0];
  hub.leadState = { selected: () => lead };
  let clock = 5000;
  const tasks = new Tasks(hub, { now: () => clock, start: false });
  hub.tasks = tasks;
  const later = new Later(hub, ':memory:', () => true, { start: false });
  const nudged = [];
  const dsh = { nudge: (id, msg) => { nudged.push([id, msg.room_id, msg.author_kind]); return true; } };
  const gateway = new CloudWebGateway(hub, { token: 'secret', logger: quiet });
  const call = async (ticket, body, room = 1) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST';
    req.headers = ticket === undefined ? {} : { 'x-later-ticket': ticket };
    const res = { writeHead(status) { this.status = status; }, end(data) { this.body = JSON.parse(data); } };
    await workspacesRoute(req, res, new URL(`http://x/collab/api/rooms/${room}/workspaces`), { store: hub.store, hub, gateway, owner: () => false, later, tasks, dsh });
    return res;
  };
  return { hub, tasks, later, nudged, call, setLead: id => { lead = id; }, now: () => clock };
}

test('G24: single primary opens a workspace by ticket; task owned by itself, watch armed, woken', async () => {
  const { hub, tasks, later, nudged, call, now } = await g24Setup(['ju']);
  const res = await call(later.ticket('ju', 1), { title: '修登录页' });
  assert.equal(res.status, 200);
  assert.equal(res.body.workspace.name, '工作区1');
  const [task] = tasks.list(1);
  assert.equal(task.owner, 'ju'); assert.equal(task.created_by, 'ju'); assert.equal(task.title, '修登录页');
  assert.equal(tasks.task(task.id).next_check_at, now() + CHECK_AFTER_S);
  assert.deepEqual(nudged, [['ju', res.body.workspace.id, 'system']]);
  assert.match(workspaceHint(hub, later, 'ju', 1), /\/collab\/api\/rooms\/1\/workspaces/);
  assert.doesNotMatch(later.instructions('ju', 1), /workspaces/, 'bridge-shared later prompt stays without the command');
});

test('G24: an @-dispatched chat task is handed over, not opened twice', async () => {
  const { hub, tasks, later, nudged, call } = await g24Setup(['ju', 'long']);
  hub.post(1, { authorKind: 'role', author: 'ju', name: 'ju', text: '@long 修登录页' });
  tasks.fromMessage(hub.store.page(1).at(-1));
  assert.equal(tasks.list(1).filter(t => ['assigned', 'accepted'].includes(t.status)).length, 1);
  const res = await call(later.ticket('ju', 1), { title: '修登录页', owner: 'long' });
  assert.equal(res.status, 200);
  const ws = res.body.workspace.id;
  const open = tasks.list(1).filter(t => ['assigned', 'accepted', 'asked', 'rework'].includes(t.status));
  assert.equal(open.length, 1, 'one open task across chat and workspace');
  assert.equal(open[0].room_id, ws); assert.equal(open[0].owner, 'long');
  assert.deepEqual(nudged.map(n => n[0]), ['long']);
  // The system handoff line is not parsed as a chat dispatch either.
  tasks.fromMessage(hub.store.page(ws).at(-1));
  assert.equal(tasks.list(ws).filter(t => t.room_id === ws).length, 1);
});

test('G24: a ticket of the former primary is refused after the primary changes', async () => {
  const { tasks, later, call, setLead } = await g24Setup(['ju', 'long']);
  const old = later.ticket('ju', 1);
  assert.equal((await call(old, { title: 'a' })).status, 200);
  setLead('long');
  const res = await call(old, { title: 'b' });
  assert.equal(res.status, 403);
  assert.equal((await call(later.ticket('long', 1), { title: 'c' })).status, 200);
  assert.equal((await call(later.ticket('long', 1), { title: 'd' }, 2)).status, 403, 'ticket for another room');
  assert.equal(tasks.list(1).length, 2, 'only the two accepted calls opened tasks');
});

test('G24: no or bad ticket is refused; owner must be a routable member', async () => {
  const { later, call } = await g24Setup(['ju']);
  assert.equal((await call(later.ticket('ju', 1), { title: 'ok' })).status, 200);
  assert.equal((await call(undefined, { title: 'x' })).status, 401);
  assert.equal((await call('bad.ticket', { title: 'x' })).status, 401);
  assert.equal((await call(later.ticket('ju', 1), { title: 'x', owner: 'owner' })).status, 404);
});

test('G24: handed to a workspace first, then @-ed in the chat channel: still one open task', async () => {
  const { hub, tasks, later, call } = await g24Setup(['ju', 'long']);
  const res = await call(later.ticket('ju', 1), { title: '修登录页', owner: 'long' });
  assert.equal(res.status, 200);
  hub.post(1, { authorKind: 'role', author: 'ju', name: 'ju', text: '@long 修登录页 已交到工作区1' });
  tasks.fromMessage(hub.store.page(1).at(-1));
  const open = tasks.list(1).filter(t => ['assigned', 'accepted', 'asked', 'rework'].includes(t.status));
  assert.equal(open.length, 1, 'the @ after the handoff opens no chat-side task');
  assert.equal(open[0].room_id, res.body.workspace.id);
  assert.equal(tasks.list(1).filter(t => t.room_id === 1).length, 0, 'no task in the chat channel to remind about');
});

test('G24: the local workspace command carries a reason into the owner\'s turn in the workspace', async () => {
  const { workspacesRoute } = await import('./plugin.mjs');
  const hub = makeHub();
  hub.setMember({ id: 'cc', name: 'CC', kind: 'dsh', online: true });
  hub.leadState = { selected: () => 'cc' };
  const tasks = new Tasks(hub, { start: false });
  hub.tasks = tasks;
  const later = new Later(hub, ':memory:', () => true, { start: false });
  const prompts = [];
  const dsh = cliMembers(hub, async text => { prompts.push(text); return '收到'; });
  const gateway = new CloudWebGateway(hub, { token: 'secret', logger: quiet });
  const server = createServer((req, res) => workspacesRoute(req, res, new URL(req.url, 'http://x'), { store: hub.store, hub, gateway, owner: () => false, later, tasks, dsh })
    ?? (res.writeHead(404), res.end('{}')));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    later.origin = `http://127.0.0.1:${server.address().port}`;
    assert.match(later.workspaceInstructions('cc', 1), /交接说明[\s\S]*用户原话[\s\S]*参照[\s\S]*分支[\s\S]*验收标准/);
    const reason = '用户原话：登录页点了没反应。参照 auth/legacy.mjs，以 main 为底，验收：点登录跳到首页';
    const out = await new Promise(resolve => {
      const child = spawn(process.execPath, [new URL('./later.mjs', import.meta.url).pathname, 'workspace', later.origin, later.ticket('cc', 1), '修登录页', '', reason]);
      let text = ''; child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
      child.on('close', status => resolve({ status, text }));
    });
    assert.equal(out.status, 0, out.text);
    await settle();
    assert.equal(prompts.length, 1, 'the owner is woken once in the workspace');
    assert.ok(prompts[0].includes(reason), 'the owner\'s turn sees the reason');
  } finally { server.close(); later.close(); }
});

test('G26: a ticket sent to /tasks gets a 403 pointing at /workspaces; /tasks auth is unchanged', async () => {
  const { hub, tasks } = makeTasks();
  const gw = new CloudWebGateway(hub, { token: 't', logger: quiet });
  const later = new Later(hub, ':memory:', () => true, { start: false });
  const call = async headers => {
    const req = Readable.from([Buffer.from(JSON.stringify({ kind: 'start', title: 'ledger', owner: 'ds' }))]);
    req.method = 'POST'; req.headers = headers;
    const res = { writeHead(s) { this.status = s; }, end(b) { this.body = JSON.parse(b); } };
    await tasksRoute(req, res, new URL('http://x/collab/api/rooms/1/tasks'), { tasks, gateway: gw, owner: () => false });
    return res;
  };
  const ticketed = await call({ 'x-later-ticket': later.ticket('ds', 1) });
  assert.equal(ticketed.status, 403);
  assert.match(ticketed.body.error, /POST \/collab\/api\/rooms\/\{id\}\/workspaces/);
  assert.equal((await call({})).status, 401, 'no ticket: plain 401 as before');
  assert.equal(tasks.list(1).length, 0, 'the ticket still opens no task on /tasks');
  later.close();
});

test('G26: the DSH workspace prompt spells out the full /workspaces call', async () => {
  const { dshTeamModeRules } = await import('./dsh-member.mjs');
  const hub = makeHub();
  const later = new Later(hub, ':memory:', () => true, { start: false });
  later.origin = 'http://127.0.0.1:5140';
  const ticket = later.ticket('ju', 1);
  const hint = later.workspaceInstructions('ju', 1);
  assert.ok(hint.includes(`curl -sS -X POST 'http://127.0.0.1:5140/collab/api/rooms/1/workspaces'`), hint);
  assert.ok(hint.includes(`X-Later-Ticket: ${ticket}`));
  assert.match(hint, /建工作区=这一条，任务和十分钟看门会自动开/);
  const rules = dshTeamModeRules();
  assert.match(rules, /POST \/collab\/api\/rooms\/\{聊天频道 id\}\/workspaces/);
  assert.match(rules, /建工作区=这一条，任务和十分钟看门会自动开/);
  later.close();
});

// #597 G34 (K10 r8): DSH watch counts in-place progress, a stance only answers a task in its own
// room, a workspace hand-back brings its result to the chat channel and wakes the dispatcher.
function g34Setup() {
  const hub = makeHub();
  hub.setMember({ id: 'zhu', name: '主', kind: 'dsh', online: true });
  hub.setMember({ id: 'fu', name: '副', kind: 'dsh', online: true });
  hub.leadState = { selected: () => 'zhu' };
  hub.teamExit = new TeamExit(hub);
  const clock = { t: 1000 };
  const tasks = new Tasks(hub, { now: () => clock.t, setTimer: () => ({}), clearTimer() {} });
  hub.tasks = tasks;
  const woken = [];
  tasks.onWake((id, m) => { woken.push([id, m.room_id, m.text]); return true; });
  const ws = hub.store.createWorkspace(1);
  const assign = (owner = 'fu') => {
    const t = tasks.assign({ roomId: ws.id, title: '记账', owner, actor: 'zhu' });
    tasks.q.setSource.run('workspace', t.id);
    return t;
  };
  const say = (room, text, author = 'fu') => hub.post(room, { authorKind: 'role', author, name: hub.members.get(author).name, text }).message;
  return { hub, tasks, clock, woken, ws, assign, say };
}

test('G34: a DSH reply opening with 【接】#id and growing in place, and its progress card, count as progress', () => {
  const { hub, tasks, clock, ws, assign } = g34Setup();
  const t = assign();
  // One draft row for the whole turn, first line the stance, edited in place (dsh-member runCli).
  const draft = hub.store.append(ws.id, { authorKind: 'role', author: 'fu', name: '副', text: `【接】#${t.id}\n\n先看代码`, draft: true }, 1100).message;
  clock.t = 1000 + CHECK_AFTER_S;
  tasks.tick();
  assert.equal(tasks.task(t.id).paused_at, null, 'text after the stance line is progress');
  assert.equal(tasks.task(t.id).renewals, 1);
  hub.store.edit(draft.id, 'role', 'fu', `【接】#${t.id}\n\n先看代码，写好了三个模块`, undefined, clock.t + 300);
  clock.t += CHECK_AFTER_S;
  tasks.tick();
  assert.equal(tasks.task(t.id).paused_at, null, 'the same row growing in the next window is progress');
  assert.equal(tasks.task(t.id).renewals, 2);

  const g = g34Setup();
  const t2 = g.assign();
  // Only a progress card, edited after it was posted (TurnProgress).
  const card = g.hub.store.append(g.ws.id, { authorKind: 'role', author: 'fu', name: '副', text: '第 3 步', card: JSON.stringify({ title: '副 · 进行中' }) }, 900).message;
  g.hub.store.edit(card.id, 'role', 'fu', '第 19 步', JSON.stringify({ title: '副 · 进行中' }), 1300);
  g.clock.t = 1000 + CHECK_AFTER_S;
  g.tasks.tick();
  assert.equal(g.tasks.task(t2.id).paused_at, null, 'a progress card moving is progress');
  // A bare stance line still is not.
  const h = g34Setup();
  const t3 = h.assign();
  h.hub.store.append(h.ws.id, { authorKind: 'role', author: 'fu', name: '副', text: `【接】#${t3.id}` }, 1100);
  h.clock.t = 1000 + CHECK_AFTER_S;
  h.tasks.tick();
  assert.ok(h.tasks.task(t3.id).paused_at, 'a stance alone is no progress');
});

test('G34: 【接】#id in the chat channel about a workspace task neither accepts nor hands it back', async () => {
  const { tasks, say, assign } = g34Setup();
  const t = assign();
  say(1, `@主 【接】#${t.id}\n\n收到，我正在工作区1里干。`);
  await settle();
  assert.equal(tasks.task(t.id).status, 'assigned');
  assert.equal(tasks.task(t.id).result_msg_id, null);
  assert.notEqual(tasks.task(t.id).next_check_at, null, 'the watch stays armed');
});

test('G34: a workspace hand-back brings its [report] body to the chat channel and wakes the dispatcher, who accepts it with 【验收】#id', async () => {
  const { hub, tasks, woken, ws, assign, say } = g34Setup();
  const t = assign();
  say(ws.id, `【接】#${t.id}\n\n先规划结构。现在写模块。\n\n[report]\n40 个测试通过，README 第一行写了暗号`);
  await settle();
  assert.equal(tasks.task(t.id).status, 'returned');
  const copies = hub.store.page(1, undefined, 50).filter(m => m.author_kind === 'system' && m.text.startsWith('📬'));
  assert.equal(copies.length, 1, 'one copy in the chat channel');
  assert.match(copies[0].text, /40 个测试通过/);
  assert.doesNotMatch(copies[0].text, /先规划结构/, 'only the [report] part');
  assert.deepEqual(woken, [['zhu', 1, copies[0].text]], 'the dispatcher is woken in the chat channel on the result');
  assert.match(copies[0].text, new RegExp(`【验收】#${t.id}`), 'the wake says how to accept');
  assert.match(copies[0].text, new RegExp(`【返工】#${t.id} 原因`), 'and how to send back');
  say(1, '验收了，结果没问题。', 'zhu');
  await settle();
  assert.equal(tasks.task(t.id).status, 'returned', 'a reply without the 【验收】 line accepts nothing');
  say(1, `看过了。\n【验收】#${t.id}`, 'zhu');
  await settle();
  assert.equal(tasks.task(t.id).status, 'done');

  // #597 G35: no [report] mark is no delivery for a DSH member: nothing is handed back or copied.
  const g = g34Setup();
  const t2 = g.assign();
  g.say(g.ws.id, `【接】#${t2.id}\n\n全做完了，测试通过`);
  await settle();
  assert.equal(g.tasks.task(t2.id).status, 'accepted');
  assert.equal(g.hub.store.page(1, undefined, 50).filter(m => m.author_kind === 'system' && m.text.startsWith('📬')).length, 0);
  assert.equal(g.woken.length, 0);
});

test('G34: only an explicit 【验收】/【返工】 line by the dispatcher, in its chat channel, reviews a workspace task', async () => {
  const { hub, tasks, clock, woken, ws, assign, say } = g34Setup();
  hub.setMember({ id: 'x', name: '旁', kind: 'dsh', online: true });
  const reworks = () => hub.store.page(ws.id, undefined, 100).filter(m => m.card && JSON.parse(m.card).event === 'rework').length;
  const t = assign();
  say(ws.id, `【接】#${t.id}\n\n[report]\n做完了`);
  await settle();
  assert.equal(tasks.task(t.id).status, 'returned');
  // The dispatcher answering something else meanwhile, or a send-back without the line.
  say(1, '好的，我先回答一下用户的问题：明天下雨。', 'zhu');
  say(1, '@副 返工：测试没跑', 'zhu');
  // Someone who did not dispatch it, and the line in another chat channel.
  say(1, `【验收】#${t.id}`, 'x');
  const other = hub.store.createRoom('别处');
  say(other.id, `【验收】#${t.id}`, 'zhu');
  say(ws.id, `【验收】#${t.id}`, 'zhu');
  await settle();
  assert.equal(tasks.task(t.id).status, 'returned', 'nothing but the dispatcher\'s explicit line reviews it');
  assert.equal(reworks(), 0, 'nor sends it back');
  const before = tasks.list(1).filter(r => r.owner === 'fu').length;

  woken.length = 0;
  // The test clock past every row so far (hub.post stamps rows with the real time).
  const t0 = clock.t = Math.ceil(Date.now() / 1000) + 100;
  say(1, `@副 改一下\n【返工】#${t.id} 测试没跑`, 'zhu');
  await settle();
  const row = tasks.task(t.id);
  assert.equal(row.status, 'rework', 'the same task goes back, no new one');
  assert.equal(row.note, '测试没跑');
  assert.equal(reworks(), 1, 'one rework recorded on the task');
  assert.equal(row.next_check_at, t0 + CHECK_AFTER_S, 'the watch is armed again');
  assert.equal(row.renewals, 0);
  assert.equal(hub.store.workspaceOwner(ws.id), 1, 'the workspace is claimed back for the chat channel');
  assert.equal(tasks.list(1).filter(r => r.owner === 'fu').length, before, 'the @ in the same reply opens no new task');
  const wake = woken.find(([id, room]) => id === 'fu' && room === ws.id);
  assert.ok(wake, 'the owner is woken in the workspace on the rework');
  assert.match(wake[2], new RegExp(`【接】#${t.id}`));
  // The watch runs again: no progress in the window parks it.
  clock.t = t0 + CHECK_AFTER_S;
  tasks.tick();
  assert.ok(tasks.task(t.id).paused_at, 'the rework is watched');
});

test('G34: a paused task resumed and handed back frees its workspace again', async () => {
  const { hub, tasks, clock, woken, ws, assign, say } = g34Setup();
  const t = assign();
  clock.t = 1000 + CHECK_AFTER_S;
  tasks.tick();
  assert.ok(tasks.task(t.id).paused_at);
  assert.equal(hub.store.workspaceOwner(ws.id), null, 'the pause released the workspace');
  const [, , pause] = woken[0];
  assert.match(pause, new RegExp(`【接】#${t.id}`), 'the pause record says how to answer');
  assert.match(pause, /\[report\]/);
  say(ws.id, `【接】#${t.id}\n\n[report]\n做完了`);
  await settle();
  assert.equal(tasks.task(t.id).status, 'returned');
  assert.equal(hub.store.workspaceOwner(ws.id), null, 'handed back after the resume: free again');
});

test('G34: a member woken on a task card record reads that record', async () => {
  const hub = makeHub();
  const prompts = [];
  const dsh = cliMembers(hub, async (text) => { prompts.push(text); return '好'; });
  const { message } = hub.post(1, { authorKind: 'system', author: 'system', name: '任务', text: '@CC #7「记账」10 分钟内没有新进展，已暂停。', card: JSON.stringify({ kind: 'task', task_id: 7, event: 'pause' }) });
  assert.equal(dsh.nudge('cc', message), true);
  await settle();
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /#7「记账」10 分钟内没有新进展/);
});

test('G35: a DSH turn ending with only 【接】#id hands nothing back; the watch stays and parks it when nothing follows', async () => {
  const { hub, tasks, clock, woken, ws, assign, say } = g34Setup();
  const t = assign();
  const due = tasks.task(t.id).next_check_at;
  // At clock time 1100 (hub.post would stamp the wall clock), through the same hub listeners.
  const row = hub.store.append(ws.id, { authorKind: 'role', author: 'fu', name: '副', text: `【接】#${t.id}\n目前保持待命，等开始写` }, 1100).message;
  tasks.fromMessage(row);
  hub.teamExit.onMessage(row);
  await settle();
  assert.equal(tasks.task(t.id).status, 'accepted', 'a stance is not a delivery');
  assert.equal(tasks.task(t.id).next_check_at, due, 'the 10-minute watch stays');
  assert.equal(hub.store.page(1, undefined, 50).filter(m => /交回/.test(m.text)).length, 0, 'no 交回 record');
  assert.equal(woken.length, 0, 'the dispatcher is not woken to review');
  clock.t = 1000 + CHECK_AFTER_S;
  tasks.tick();
  assert.equal(tasks.task(t.id).renewals, 1, 'its own words in the window renew once');
  clock.t += CHECK_AFTER_S;
  tasks.tick();
  assert.ok(tasks.task(t.id).paused_at, 'a window with nothing new parks it');
  assert.ok(woken.some(([id, , text]) => id === 'fu' && /已暂停/.test(text)), 'and the owner is reminded');
});

test('G35: a DSH [ask] is forwarded as a question, not a hand-back, and its task stays watched in its workspace', async () => {
  const { hub, tasks, woken, ws, assign, say } = g34Setup();
  const t = assign();
  const due = tasks.task(t.id).next_check_at;
  say(ws.id, `【接】#${t.id}\n先看了现状。\n\n[ask]\n方案 A 还是 B？\n自验：无需\n类别：方向`);
  await settle();
  const task = tasks.task(t.id);
  assert.equal(task.status, 'accepted', 'not returned');
  assert.equal(task.paused_at, null, 'not parked');
  assert.equal(task.next_check_at, due, 'the watch stays');
  assert.equal(hub.store.workspaceOwner(ws.id), 1, 'the workspace stays with its chat channel');
  const copies = hub.store.page(1, undefined, 50).filter(m => m.text.startsWith('📬'));
  assert.equal(copies.length, 1);
  assert.match(copies[0].text, /ask-[0-9a-f]{8}/, 'forwarded as an ask');
  assert.equal(hub.store.page(1, undefined, 50).filter(m => /交回/.test(m.text)).length, 0);
  assert.equal(woken.length, 0);
});

test('G35: while a DSH [ask] waits on the user the watch wakes nobody and keeps the workspace; the answer re-arms it', async () => {
  const { hub, tasks, clock, woken, ws, assign } = g34Setup();
  const t = assign();
  const row = hub.store.append(ws.id, { authorKind: 'role', author: 'fu', name: '副', text: `【接】#${t.id}\n看了现状\n\n[ask]\n方案 A 还是 B？\n自验：无需\n类别：方向` }, 1100).message;
  tasks.fromMessage(row);
  hub.teamExit.onMessage(row);
  await settle();
  // 30 minutes and more of silence from the user: three watch windows.
  for (let i = 1; i <= 4; i++) {
    clock.t = 1000 + i * CHECK_AFTER_S;
    tasks.tick();
  }
  const waiting = tasks.task(t.id);
  assert.equal(waiting.paused_at, null, 'not parked while the user has not answered');
  assert.equal(waiting.renewals, 0, 'waiting on the user spends no renewal');
  assert.equal(waiting.next_check_at, clock.t + CHECK_AFTER_S);
  assert.equal(woken.filter(([id]) => id === 'fu').length, 0, 'the owner is never woken');
  assert.equal(hub.store.page(ws.id, undefined, 50).filter(m => /已暂停/.test(m.text)).length, 0, 'no pause record');
  assert.equal(hub.store.workspaceOwner(ws.id), 1, 'the workspace stays with its chat channel');
  // The user answers the forwarded [ask]: it reaches the workspace and the watch starts again from now.
  const fwd = hub.store.page(1, undefined, 50).find(m => /ask-[0-9a-f]{8}/.test(m.text));
  clock.t += 120;
  hub.post(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '选 A', replyTo: fwd.id });
  await settle();
  assert.ok(hub.store.page(ws.id, undefined, 50).some(m => /用户回复 ask-/.test(m.text)), 'the answer reaches the workspace');
  assert.equal(tasks.task(t.id).next_check_at, clock.t + CHECK_AFTER_S, 'the watch is re-armed on the answer');
  clock.t += CHECK_AFTER_S;
  tasks.tick();
  assert.ok(tasks.task(t.id).paused_at, 'answered and then silent: the watch parks it again');
  assert.ok(woken.some(([id, , text]) => id === 'fu' && /已暂停/.test(text)));
});

test('G35: an unanswered [ask] the owner moved on from (hand-back, rework) does not hold the watch', async () => {
  const { hub, tasks, clock, woken, ws, assign, say } = g34Setup();
  const t = assign();
  const row = hub.store.append(ws.id, { authorKind: 'role', author: 'fu', name: '副', text: `【接】#${t.id}\n[ask]\n要不要顺手改 B？\n自验：无需\n类别：方向` }, 1100).message;
  tasks.fromMessage(row);
  hub.teamExit.onMessage(row);
  await settle();
  say(ws.id, '[report]\n先按 A 做完了');
  await settle();
  assert.equal(tasks.task(t.id).status, 'returned');
  say(1, `【返工】#${t.id} 测试没跑`, 'zhu');
  await settle();
  assert.equal(tasks.task(t.id).status, 'rework');
  for (let i = 1; i <= 4; i++) {
    clock.t = 1000 + i * (CHECK_AFTER_S + 1);
    tasks.tick();
  }
  assert.ok(tasks.task(t.id).paused_at, 'a stale [ask] does not push the watch forever');
  assert.ok(woken.some(([id, , text]) => id === 'fu' && /已暂停/.test(text)), 'the owner is nudged');
});

test('G35: in a workspace the lead @-ing a teammate still opens its mention task, watched there', async () => {
  const { hub, tasks, ws, assign, say } = g34Setup();
  const t = assign('zhu');
  say(ws.id, '@副 测试和 README 交给你写', 'zhu');
  await settle();
  const listed = tasks.list(ws.id).find(r => r.owner === 'fu');
  assert.ok(listed, 'the dispatch opens a task on the board');
  const sub = tasks.task(listed.id);
  assert.equal(sub.source, 'mention');
  assert.equal(sub.status, 'assigned');
  assert.ok(tasks.watched(sub) && sub.next_check_at != null, 'and its 10-minute watch');
  assert.equal(tasks.task(t.id).status, 'assigned', 'the lead\'s own task stays as it was');
  // The teammate's reply @-ing the lead without [report] is no hand-back in a workspace.
  say(ws.id, '@主 收到，先写测试');
  await settle();
  assert.equal(tasks.task(sub.id).status, 'assigned', 'no [report], no hand-back');
});

test('G35: a [report] under 【接】#id of a task already done hands back no other open task', async () => {
  const { tasks, ws, assign, say } = g34Setup();
  const done = assign();
  say(ws.id, `【接】#${done.id}\n\n[report]\n做完了`);
  await settle();
  tasks.review(done.id, { actor: 'zhu', verdict: 'done' });
  const open = assign();
  say(ws.id, `【接】#${done.id}\n\n[report]\n再补一句`);
  await settle();
  assert.equal(tasks.task(open.id).status, 'assigned', 'the other task stays open');
});

test('G35: a DSH reply whose last part is [report] hands back, with or without a stance line', async () => {
  const { tasks, ws, assign, say } = g34Setup();
  const t = assign();
  say(ws.id, `【接】#${t.id}\n\n写完了。\n\n[report]\n测试 12 个通过`);
  await settle();
  assert.equal(tasks.task(t.id).status, 'returned');
  const g = g34Setup();
  const t2 = g.assign();
  g.say(g.ws.id, `【接】#${t2.id}`);
  await settle();
  assert.equal(g.tasks.task(t2.id).status, 'accepted');
  g.say(g.ws.id, '[report]\n做完了，测试通过');
  await settle();
  assert.equal(g.tasks.task(t2.id).status, 'returned', 'a later [report] turn delivers the open task');
});

// #597 G37 (K10 r10): a DSH reply comes back as 「@主 [report]…」 (returnToLead puts the @ first); the
// lead's [report] may dispatch too; an [ask] answer reaches the workspace by the member's name.
test('G37: a DSH reply 「@主 [report]」 hands back and its result is copied to the chat channel', async () => {
  const { hub, tasks, ws, assign, say } = g34Setup();
  const t = assign();
  say(ws.id, '@主 [report]\n已完成，测试 8 个通过');
  await settle();
  assert.equal(tasks.task(t.id).status, 'returned', 'the @-prefixed [report] is a hand-back');
  const copies = hub.store.page(1, undefined, 50).filter(m => m.author_kind === 'system' && m.text.startsWith('📬'));
  assert.equal(copies.length, 1, 'one copy in the chat channel');
  assert.match(copies[0].text, /测试 8 个通过/);
  const g = g34Setup();
  const t2 = g.assign();
  g.say(g.ws.id, `@主 【接】#${t2.id}\n写完了\n\n[report]\n做完了`);
  await settle();
  assert.equal(g.tasks.task(t2.id).status, 'returned', 'with a stance line too');
});

test('G37: the lead\'s [report] in a workspace hands back its task and its @ still dispatches', async () => {
  const { tasks, ws, assign, say } = g34Setup();
  const t = assign('zhu');
  say(ws.id, `【接】#${t.id}\n[report]\n做完了\n@副，请你核对 README`, 'zhu');
  await settle();
  assert.equal(tasks.task(t.id).status, 'returned', 'the lead\'s own task is handed back');
  const sub = tasks.list(ws.id).find(r => r.owner === 'fu');
  assert.ok(sub, 'the @副 in the [report] opens her task');
  assert.equal(tasks.task(sub.id).source, 'mention');
  assert.equal(tasks.task(sub.id).title, '请你核对 README', 'the title is content, not the stance line or the mark');
});

test('G37: an [ask] answer reaches the workspace @-ing the member by name, not by id', async () => {
  const { hub, tasks, ws, assign } = g34Setup();
  const t = assign();
  const row = hub.store.append(ws.id, { authorKind: 'role', author: 'fu', name: '副', text: `【接】#${t.id}\n[ask]\n方案 A 还是 B？\n自验：无需\n类别：方向` }, 1100).message;
  tasks.fromMessage(row);
  hub.teamExit.onMessage(row);
  await settle();
  const fwd = hub.store.page(1, undefined, 50).find(m => /ask-[0-9a-f]{8}/.test(m.text));
  hub.post(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '选 A', replyTo: fwd.id });
  await settle();
  const answer = hub.store.page(ws.id, undefined, 50).find(m => /用户回复 ask-/.test(m.text));
  assert.match(answer.text, /^@副 用户回复 ask-/);
  assert.doesNotMatch(answer.text, /@fu\b/, 'no member id in the text');
  assert.deepEqual([...mentions(answer.text, hub.routable())], ['fu'], 'the name still routes to her');
  const t2 = assign('zhu');
  const ask2 = hub.store.append(ws.id, { authorKind: 'role', author: 'zhu', name: '主', text: `【接】#${t2.id}\n[ask]\n要不要改 C？\n自验：无需\n类别：方向` }, 1200).message;
  hub.teamExit.onMessage(ask2);
  await settle();
  hub.store.db.prepare("UPDATE team_exit_asks SET member_id = 'gone' WHERE source_id = ?").run(ask2.id);
  const fwd2 = hub.store.page(1, undefined, 50).filter(m => /ask-[0-9a-f]{8}/.test(m.text)).at(-1);
  hub.post(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '不改', replyTo: fwd2.id });
  await settle();
  assert.ok(hub.store.page(ws.id, undefined, 50).some(m => /^@gone 用户回复 ask-/.test(m.text)), 'a member no longer there falls back to its id');
});
