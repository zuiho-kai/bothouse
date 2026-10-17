// Real page scripts with controlled HTTP/timers and fake media, not audible output.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const staticDir = path.join(__dirname, '../voice/static');
const flush = () => new Promise((resolve) => setImmediate(resolve));

class Node {
  constructor() {
    this.listeners = new Map(); this.children = []; this.value = ''; this.textContent = '';
    this.disabled = false; this.hidden = false;
    this.classList = { toggle() {}, remove() {} };
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, event = {}) { for (const fn of [...(this.listeners.get(type) || [])]) fn({ preventDefault() {}, ...event }); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  removeAttribute(name) { this[name] = ''; }
  remove() {}
}

class FakeAudio extends Node {
  constructor() {
    super(); this.src = ''; this.currentSrc = ''; this.currentTime = 0; this.duration = NaN;
    this.paused = true; this.ended = false; this.error = null; this.plays = []; this.nextPlay = null;
  }
  load() { this.currentSrc = this.src; this.currentTime = 0; this.duration = 0.64; this.ended = false; this.error = null; }
  play() {
    this.plays.push(this.src);
    if (this.nextPlay) { const play = this.nextPlay; this.nextPlay = null; return play(); }
    this.paused = false; this.ended = false;
    queueMicrotask(() => this.emit('playing'));
    return Promise.resolve();
  }
  pause() { if (!this.paused) { this.paused = true; queueMicrotask(() => this.emit('pause')); } }
  end() { this.currentTime = this.duration; this.paused = true; this.ended = true; this.emit('ended'); }
}

const chunk = (index) => ({ index, audio_url: '/api/turn/t1/audio/chunks/' + index, duration_seconds: 0.64 });
const streaming = (overrides = {}) => ({ id: 't1', project: 'a', status: 'synthesizing', text: '真实回答',
  audio_chunks: [chunk(0)], audio_complete: false, timings: { tts_first_chunk_ms: 100 }, ...overrides });

async function page(name, { turn = streaming(), config = {}, request } = {}) {
  const nodes = new Map();
  const document = new Node();
  document.currentScript = { src: 'http://localhost/static/' + name + '.js' };
  document.getElementById = (id) => { if (!nodes.has(id)) nodes.set(id, id === 'audio' ? new FakeAudio() : new Node()); return nodes.get(id); };
  document.createElement = () => new Node();
  const window = new Node();
  const location = { href: 'http://localhost/', origin: 'http://localhost', reload() {} };
  const timers = new Map(); let timerId = 0;
  const requests = [];
  let nextUUID = 0;
  const state = { turn };
  const roles = [{ id: 'a', name: 'A', available: true }, { id: 'b', name: 'B', available: true }];
  const storage = new Map();
  const sandbox = { document, window, location, URL, Headers, AbortController, Error, console,
    crypto: { randomUUID: () => 't' + (++nextUUID) },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); }, clearInterval() {},
    async fetch(url, init = {}) {
      const body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ url, body });
      const custom = request && await request(url, body, state);
      if (custom instanceof Error) throw custom;
      const data = custom ?? (url === '/api/config' ? { token: 'fixture', roles, default_role: 'a', ...config }
        : url === '/api/turn' ? { id: body.id } : body ? {} : state.turn);
      const status = data.httpStatus || 200;
      return { ok: status < 400, status, text: async () => JSON.stringify(data.httpStatus ? data.data : data) };
    }
  };
  window.crypto = sandbox.crypto;
  const context = vm.createContext(sandbox);
  const html = fs.readFileSync(path.join(staticDir, name === 'app' ? 'index.html' : 'discussion.html'), 'utf8');
  for (const [, script] of html.matchAll(new RegExp('<script src="/static/([^"]+)" defer></script>', 'g'))) {
    vm.runInContext(fs.readFileSync(path.join(staticDir, script), 'utf8'), context, { filename: script });
  }
  await flush();
  return { nodes, document, window, state, requests, audio: nodes.get('audio'),
    async click(id) { assert.equal(nodes.get(id).disabled, false, id + ' should be enabled'); nodes.get(id).emit('click'); await flush(); },
    async submit() {
      nodes.get('draft').value = '你好'; nodes.get('message-form').emit('submit'); await flush();
    },
    async start(poll = true) {
      for (const label of nodes.get('roles').children) {
        const input = label.children[0]; input.checked = true; input.emit('change');
      }
      nodes.get('topic').value = '讨论话题'; nodes.get('topic').emit('input');
      nodes.get('discussion-form').emit('submit'); await flush();
      if (poll) await this.tick();
    },
    async tick(maxDelay = 200) {
      const entry = [...timers].find(([, timer]) => timer.delay <= maxDelay);
      assert.ok(entry, 'expected a poll within ' + maxDelay + 'ms');
      timers.delete(entry[0]); entry[1].fn(); await flush();
    }
  };
}

test('ordinary page plays the first chunk while the complete WAV is still unavailable', async () => {
  const p = await page('app');
  await p.submit();
  assert.deepEqual(p.audio.plays, ['http://localhost/api/turn/t1/audio/chunks/0']);
  assert.equal(p.state.turn.status, 'synthesizing');
  assert.equal(p.requests.some((r) => r.body?.state === 'completed'), false);
});

test('ordinary thinking-to-stream transition is observed within the 200ms poll interval', async () => {
  const p = await page('app', { turn: streaming({ status: 'thinking', text: '', audio_chunks: undefined }) });
  await p.submit();
  assert.equal(p.audio.plays.length, 0);
  p.state.turn = streaming(); await p.tick(200);
  assert.equal(p.audio.plays.at(-1), 'http://localhost/api/turn/t1/audio/chunks/0');
});

const discussion = (turn, status = 'running') => ({ id: 't1', status, projects: ['a', 'b'], topic: '讨论话题',
  total_turns: 5, current_turn_id: turn.id,
  turns: [{ discussion_id: 't1', phase: 'opening', round: 1, ...turn }] });

async function discussionPage(options = {}) {
  return page('discussion', { ...options, request: async (url, body, state) => {
    const custom = await options.request?.(url, body, state);
    return custom ?? (url === '/api/discussion' || url === '/api/discussion/t1' ? discussion(state.turn, state.status || 'running') : undefined);
  } });
}

async function started(name, options) {
  const p = name === 'app' ? await page(name, options) : await discussionPage(options);
  if (name === 'app') await p.submit(); else await p.start();
  return p;
}

test('discussion plays the first chunk while discussion is running', async () => {
  const p = await discussionPage();
  await p.start();
  assert.deepEqual(p.audio.plays, ['http://localhost/api/turn/t1/audio/chunks/0']);
  assert.equal(p.requests.some((r) => r.url.endsWith('/advance')), false);
});

const ready = (chunks = [chunk(0), chunk(1)]) => streaming({ status: 'ready', audio_complete: true,
  audio_chunks: chunks, audio_url: '/api/turn/t1/audio' });
const reports = (p, state) => p.requests.filter((r) => r.url.endsWith('/playback') && r.body.state === state);

test('ordinary page waits for delayed first/tail chunks and reports cumulative duration exactly once', async () => {
  const p = await page('app', { turn: streaming({ audio_chunks: [] }) });
  await p.submit();
  assert.deepEqual(p.audio.plays, []);
  p.state.turn = streaming(); await p.tick();
  p.audio.end(); await flush();
  assert.equal(reports(p, 'completed').length, 0);
  await p.tick();
  assert.equal(p.audio.plays.length, 1, 'duplicate poll must not replay an ended chunk');
  p.state.turn = streaming({ audio_chunks: [chunk(0), chunk(1)] }); await p.tick();
  p.audio.end(); await flush();
  assert.equal(reports(p, 'completed').length, 0, 'tail ended still awaits audio_complete');
  p.state.turn = ready(); await p.tick();
  assert.deepEqual(reports(p, 'completed').map((r) => r.body), [{ state: 'completed', position_seconds: 1.28, duration_seconds: 1.28 }]);
  assert.equal(reports(p, 'playing').length, 1);
  assert.deepEqual(p.audio.plays, ['http://localhost/api/turn/t1/audio/chunks/0', 'http://localhost/api/turn/t1/audio/chunks/1']);
  await p.click('play');
  assert.equal(p.audio.plays.at(-1), 'http://localhost/api/turn/t1/audio');
  p.audio.currentTime = 0.3;
  await p.click('stop'); await p.click('play');
  assert.equal(p.audio.currentTime, 0.3, 'manual resume retains its position during a whole-WAV replay');
  p.audio.duration = 1.279; p.audio.end(); await flush();
  assert.equal(reports(p, 'completed').at(-1).body.duration_seconds, 1.28, 'whole-WAV replay uses the same exact chunk total');
});

test('discussion waits through ready/running until awaiting_playback and confirms before advancing', async () => {
  const p = await discussionPage(); await p.start();
  p.audio.end(); await flush();
  p.state.turn = ready([chunk(0)]); await p.tick();
  assert.equal(reports(p, 'completed').length, 0);
  assert.equal(p.requests.filter((r) => r.url.endsWith('/advance')).length, 0);
  p.state.status = 'awaiting_playback'; await p.tick();
  assert.deepEqual(reports(p, 'completed').map((r) => r.body), [{ state: 'completed', position_seconds: 0.64, duration_seconds: 0.64 }]);
  const advance = p.requests.findIndex((r) => r.url.endsWith('/advance'));
  assert.ok(advance > p.requests.findIndex((r) => r.body?.state === 'completed'));
  await p.tick();
  assert.equal(p.requests.filter((r) => r.url.endsWith('/advance')).length, 1);
});

for (const name of ['app', 'discussion']) {
  test(name + ': synthesis failure stops current audio, preserves text and cannot complete or replay', async () => {
    const p = await started(name);
    p.state.turn = streaming({ status: 'error', error: 'TTS fixture failed' });
    await p.tick();
    assert.equal(p.audio.paused, true);
    p.audio.end(); await flush();
    assert.equal(reports(p, 'completed').length, 0);
    assert.equal(p.requests.some((r) => r.url.endsWith('/advance')), false);
    assert.equal(p.nodes.get('play').disabled, true);
    const contents = (node) => node.textContent + node.children.map(contents).join('');
    assert.match(contents(p.nodes.get(name === 'app' ? 'records' : 'turns')), /真实回答.*TTS fixture failed/);
    assert.equal(p.requests.filter((r) => r.url === (name === 'app' ? '/api/turn' : '/api/discussion') && r.body).length, 1);
  });

  test(name + ': hiding pauses during the tail gap; visible polls do not resume until a click', async () => {
    const p = await started(name);
    p.audio.end(); await flush();
    p.document.hidden = true; p.document.emit('visibilitychange'); await flush();
    p.document.hidden = false; p.document.emit('visibilitychange');
    p.state.turn = ready(); p.state.status = 'awaiting_playback'; await p.tick();
    assert.equal(p.audio.plays.length, 1);
    assert.equal(reports(p, 'completed').length, 0);
    await p.click('play');
    assert.equal(p.audio.plays.at(-1), 'http://localhost/api/turn/t1/audio/chunks/1');
    p.audio.end(); await flush();
    assert.equal(reports(p, 'completed').length, 1);
  });

  test(name + ': autoplay rejection never retries on polls, but an explicit click resumes', async () => {
    const p = name === 'app' ? await page(name) : await discussionPage();
    p.audio.nextPlay = () => Promise.reject(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' }));
    if (name === 'app') await p.submit(); else await p.start();
    assert.equal(reports(p, 'failed').length, 1);
    await p.tick();
    p.state.turn = ready(); p.state.status = 'awaiting_playback'; await p.tick();
    assert.equal(p.audio.plays.length, 1);
    assert.equal(reports(p, 'completed').length, 0);
    await p.click('play');
    p.audio.end(); await flush(); p.audio.end(); await flush();
    assert.equal(reports(p, 'completed').length, 1);
  });

  test(name + ': restored stream is read-only until a human starts audio', async () => {
    const options = { config: name === 'app' ? { active_turn: 't1' } : { active_discussion: 't1' } };
    const p = name === 'app' ? await page(name, options) : await discussionPage(options);
    await p.tick();
    assert.equal(p.audio.plays.length, 0);
    assert.equal(p.requests.filter((r) => r.body).length, 0);
    await p.click('play');
    assert.equal(p.audio.plays.at(-1), 'http://localhost/api/turn/t1/audio/chunks/0');
  });

  test(name + ': legacy full WAV still plays and completes', async () => {
    const turn = { id: 't1', project: 'a', status: 'ready', text: '传统回答', audio_url: '/api/turn/t1/audio' };
    const p = await started(name, { turn });
    if (name === 'discussion') { p.state.status = 'awaiting_playback'; await p.tick(); }
    assert.deepEqual(p.audio.plays, ['http://localhost/api/turn/t1/audio']);
    p.audio.end(); await flush();
    assert.equal(reports(p, 'completed').length, 1);
  });
}

test('ordinary stop suppresses delayed audio until a human resumes', async () => {
  const p = await started('app', { turn: streaming({ audio_chunks: [] }) });
  await p.click('stop');
  p.state.turn = ready(); await p.tick();
  assert.equal(p.audio.plays.length, 0);
  await p.click('play');
  assert.equal(p.audio.plays.length, 1);
});

test('discussion stop discards an older in-flight poll and cannot advance from stale ended', async () => {
  let release;
  let hold = false;
  const p = await started('discussion', { request: (url, body, state) => {
    if (url === '/api/discussion/t1' && hold) return new Promise((resolve) => { release = resolve; });
    if (url.endsWith('/stop')) return { ...discussion(state.turn, 'stopping'), stop_requested: true };
  } });
  hold = true; await p.tick();
  const oldEnded = [...p.audio.listeners.get('ended')];
  await p.click('stop');
  assert.equal(p.audio.paused, true);
  release(discussion(ready(), 'awaiting_playback')); await flush();
  p.audio.ended = true; oldEnded.forEach((fn) => fn()); await flush();
  assert.equal(p.audio.plays.length, 1);
  assert.equal(reports(p, 'completed').length, 0);
  assert.equal(p.requests.some((r) => r.url.endsWith('/advance')), false);
});

test('discussion stop while completed receipt is pending prevents advance', async () => {
  let release;
  const p = await started('discussion', { turn: ready([chunk(0)]), request: (url, body, state) => {
    if (body?.state === 'completed') return new Promise((resolve) => { release = resolve; });
    if (url.endsWith('/stop')) return { ...discussion(state.turn, 'stopped'), stop_requested: true };
  } });
  p.state.status = 'awaiting_playback'; await p.tick();
  p.audio.end(); await flush();
  assert.equal(typeof release, 'function');
  await p.click('stop');
  release({}); await flush();
  assert.equal(p.requests.some((r) => r.url.endsWith('/advance')), false);
  assert.equal(p.audio.paused, true);
});

for (const name of ['app', 'discussion']) {
  test(name + ': query failure pauses audio, query recovery alone does not resume', async () => {
    let failRead = false;
    const p = await started(name, { request: (url, body) => {
      if (!body && url === (name === 'app' ? '/api/turn/t1' : '/api/discussion/t1') && failRead) return new Error('network fixture failed');
    } });
    failRead = true; await p.tick();
    assert.equal(p.audio.paused, true);
    failRead = false;
    if (name === 'app') {
      const retry = p.nodes.get('records').children[0].children.find((node) => node.textContent === '重新查询本轮状态');
      retry.emit('click'); await flush();
    } else { await p.click('retry-query'); await p.tick(); }
    assert.equal(p.audio.plays.length, 1);
    await p.click('play');
    assert.equal(p.audio.plays.length, 2);
    assert.equal(reports(p, 'completed').length, 0);
  });

  test(name + ': pagehide invalidates a pending poll and stale playback callbacks', async () => {
    let release;
    let hold = false;
    const p = await started(name, { request: (url, body) => {
      if (hold && !body && url === (name === 'app' ? '/api/turn/t1' : '/api/discussion/t1')) return new Promise((resolve) => { release = resolve; });
    } });
    hold = true; await p.tick();
    const oldEnded = [...p.audio.listeners.get('ended')];
    p.window.emit('pagehide');
    release(name === 'app' ? ready() : discussion(ready(), 'awaiting_playback')); await flush();
    p.audio.ended = true; oldEnded.forEach((fn) => fn()); await flush();
    assert.equal(p.audio.paused, true);
    assert.equal(p.audio.plays.length, 1);
    assert.equal(reports(p, 'completed').length, 0);
    assert.equal(p.requests.some((r) => r.url.endsWith('/advance')), false);
  });
}

test('ordinary role change stops queued audio and cannot be undone by a later ready poll', async () => {
  const p = await started('app');
  p.audio.end(); await flush();
  p.nodes.get('role').value = 'b'; p.nodes.get('role').emit('change');
  p.state.turn = ready(); await p.tick();
  assert.equal(p.audio.plays.length, 1);
  assert.equal(reports(p, 'completed').length, 0);
});

test('ordinary invalid chunk URL produces an explicit error instead of a stuck play intent', async () => {
  const p = await started('app', { turn: streaming({ audio_chunks: [{ ...chunk(0), audio_url: 'https://other.example/chunk' }] }) });
  assert.equal(p.audio.plays.length, 0);
  const errors = p.nodes.get('records').children[0].children.filter((node) => node.className === 'record-error' && !node.hidden);
  assert.ok(errors.length, 'malformed audio is explicitly visible');
  assert.equal(p.nodes.get('stop').disabled, true, 'failed setup leaves no active intent');
});

test('ordinary missing final text stops an already playing stream', async () => {
  const p = await started('app');
  p.state.turn = { ...ready(), text: '' }; await p.tick();
  assert.equal(p.audio.paused, true);
  assert.equal(p.nodes.get('play').disabled, true);
  assert.equal(reports(p, 'completed').length, 0);
});

test('ordinary history replay selects the full WAV after another turn used the player', async () => {
  const p = await started('app', { turn: ready([chunk(0)]) });
  p.audio.end(); await flush();
  p.state.turn = { id: 't2', project: 'a', status: 'ready', text: '下一轮', audio_url: '/api/turn/t2/audio' };
  await p.submit(); p.audio.end(); await flush();
  const replay = p.nodes.get('records').children[1].children.find((node) => node.textContent === '播放这轮回答');
  assert.equal(replay.disabled, false);
  replay.emit('click'); await flush();
  assert.equal(p.audio.plays.at(-1), 'http://localhost/api/turn/t1/audio');
});

test('discussion expiry stops audio and rejects manual continuation until refresh', async () => {
  let expire = false;
  const p = await started('discussion', { request: (url, body) => {
    if (expire && !body) return { httpStatus: 403, data: { detail: 'expired' } };
  } });
  expire = true; await p.tick();
  p.audio.end(); await flush();
  assert.equal(p.audio.paused, true);
  assert.equal(p.nodes.get('play').disabled, true);
  assert.equal(p.nodes.get('refresh-page').hidden, false);
  assert.equal(reports(p, 'completed').length, 0);
});

test('discussion uncertain start only retries the original request on explicit click', async () => {
  let first = true;
  const p = await discussionPage({ request: (url) => {
    if (url === '/api/discussion' && first) { first = false; return new Error('lost start response'); }
  } });
  await p.start(false);
  const starts = () => p.requests.filter((r) => r.url === '/api/discussion');
  assert.equal(starts().length, 1);
  assert.equal(p.audio.plays.length, 0);
  await p.click('retry-start'); await p.tick();
  assert.equal(starts().length, 2);
  assert.deepEqual(starts()[1].body, starts()[0].body);
  assert.equal(p.audio.plays.length, 0, 'uncertain-start recovery must still require a playback click');
});

test('discussion lost advance response is queried and retried using the same completed turn only on click', async () => {
  let first = true;
  const p = await started('discussion', { turn: ready([chunk(0)]), request: (url) => {
    if (url.endsWith('/advance') && first) { first = false; return new Error('lost advance response'); }
  } });
  p.state.status = 'awaiting_playback'; await p.tick();
  p.audio.end(); await flush();
  const advances = () => p.requests.filter((r) => r.url.endsWith('/advance'));
  assert.equal(advances().length, 1);
  await p.click('retry-query'); await p.tick();
  assert.equal(advances().length, 1);
  assert.equal(p.audio.plays.length, 1);
  await p.click('retry-advance');
  assert.equal(advances().length, 2);
  assert.deepEqual(advances()[1].body, { turn_id: 't1', outcome: 'completed' });
});

test('completed discussion can replay the complete WAV without advancing or replaying chunks', async () => {
  const p = await discussionPage({ config: { last_discussion: 't1' }, turn: ready(),
    request: (url) => url === '/api/discussion/t1' ? discussion(ready(), 'completed') : undefined });
  await p.tick();
  const replay = p.nodes.get('turns').children[0].children.find((node) => node.textContent === '重播整段');
  assert.ok(replay, 'successful turns expose an explicit whole-WAV replay');
  assert.equal(replay.disabled, false);
  replay.emit('click'); await flush();
  assert.deepEqual(p.audio.plays, ['http://localhost/api/turn/t1/audio']);
  assert.equal(p.nodes.get('play').disabled, false, 'a replay can be paused');
  p.audio.duration = 1.28; p.audio.end(); await flush();
  assert.equal(reports(p, 'completed').length, 1);
  assert.equal(p.requests.some((r) => r.url.endsWith('/advance')), false);
});

const VoiceQueuePlayer = require('../voice/static/queue-player.js');
function queue() {
  const audio = new FakeAudio();
  const states = [];
  const player = new VoiceQueuePlayer(audio, { baseURL: 'http://localhost/',
    onState: (state, snapshot, error) => states.push({ state, snapshot, error }) });
  return { audio, states, player };
}

test('queue orders indexes, ignores duplicate polls, and waits for a missing prefix', async () => {
  const { audio, states, player } = queue();
  player.select(streaming({ audio_chunks: [chunk(1)] })); player.start(); await flush();
  assert.equal(audio.plays.length, 0);
  player.update(streaming({ audio_chunks: [chunk(1), chunk(0), chunk(0)] })); await flush();
  audio.end(); await flush();
  player.update(streaming({ audio_chunks: [chunk(1), chunk(0)] }));
  audio.end(); await flush();
  player.update(ready());
  assert.deepEqual(audio.plays, ['http://localhost/api/turn/t1/audio/chunks/0', 'http://localhost/api/turn/t1/audio/chunks/1']);
  assert.deepEqual(states.filter((event) => event.state === 'completed').map((event) => event.snapshot), [{ position: 1.28, duration: 1.28 }]);
});

test('queue rejects stale play promises and captured ended/error handlers after a new selection', async () => {
  const { audio, states, player } = queue();
  let rejectOld;
  audio.nextPlay = () => new Promise((resolve, reject) => { rejectOld = reject; });
  player.select(ready([chunk(0)])); player.start();
  const oldEnded = [...audio.listeners.get('ended')];
  const oldError = [...audio.listeners.get('error')];
  player.select({ ...ready([chunk(0)]), id: 't2' }); player.start(); await flush();
  const before = states.length;
  audio.ended = true; audio.error = { code: 3 };
  oldEnded.forEach((fn) => fn()); oldError.forEach((fn) => fn());
  rejectOld(Object.assign(new Error('stale rejection'), { name: 'NotAllowedError' })); await flush();
  player.update(streaming({ id: 't1', status: 'error' }));
  assert.equal(states.length, before);
  assert.equal(audio.paused, false, 'old promise cannot pause the new playback');
  audio.error = null; audio.end(); await flush();
  assert.equal(states.filter((event) => event.state === 'completed').length, 1);
});

test('queue media error stops immediately; later chunks need an explicit start', async () => {
  const { audio, states, player } = queue();
  player.select(streaming()); player.start(); await flush();
  audio.error = { code: 3 }; audio.emit('error');
  player.update(ready()); await flush();
  assert.equal(audio.paused, true);
  assert.equal(audio.plays.length, 1);
  assert.equal(states.filter((event) => event.state === 'failed').length, 1);
  assert.equal(states.filter((event) => event.state === 'completed').length, 0);
  player.start(); await flush(); audio.end(); await flush(); audio.end(); await flush();
  assert.equal(states.filter((event) => event.state === 'completed').length, 1);
});

test('queue requires both ready and audio_complete, even after the last ended', async () => {
  const { audio, states, player } = queue();
  player.select(streaming({ audio_complete: true })); player.start(); await flush(); audio.end();
  player.update(streaming({ status: 'ready', audio_complete: false }));
  assert.equal(states.filter((event) => event.state === 'completed').length, 0);
  player.update(ready([chunk(0)]));
  assert.equal(states.filter((event) => event.state === 'completed').length, 1);
});
