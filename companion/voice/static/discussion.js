'use strict';

(() => {
  const ids = ['connection-state', 'reload-config', 'refresh-page', 'page-error', 'discussion-form',
    'role-fieldset', 'roles', 'selection-order', 'topic', 'plan', 'start', 'discussion-state',
    'task-note', 'discussion-topic', 'retry-query', 'retry-start', 'retry-advance', 'empty-state',
    'turns', 'playback-state', 'playback-time', 'playback-progress', 'play', 'skip', 'stop', 'audio'];
  const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const audio = ui.audio;
  const storageKey = 'conest.discussion.pending.v1';
  const terminal = new Set(['stopped', 'completed', 'error']);
  const statusNames = { running: '讨论中', awaiting_playback: '等待听完本段', stopping: '正在停止', stopped: '已停止', completed: '讨论完成', error: '讨论失败' };
  const turnStatusNames = { thinking: '正在思考', synthesizing: '正在合成语音', ready: '语音已就绪', error: '本段失败' };
  const phaseNames = { opening: '各自发言', response: '交流回应', summary: '总结共同点与分歧' };
  const roleNodes = new Map();
  const turnNodes = new Map();
  let config = null;
  let session = null;
  let selected = [];
  let loading = false;
  let expired = false;
  let disposed = false;
  let pendingStart = null;
  let savedStopId = null;
  let pollTimer = null;
  let pollInFlight = false;
  let playIntent = null;
  let loadedTurn = null;
  const player = new VoiceQueuePlayer(audio, { baseURL: location.href, onState: playbackState, onProgress: updateProgress });

  const message = (error) => error instanceof Error ? error.message : String(error);
  const number = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
  const clock = (value) => `${Math.floor(number(value) / 60)}:${String(Math.floor(number(value) % 60)).padStart(2, '0')}`;
  const same = (ctx) => Boolean(ctx) && !disposed && session === ctx;
  const mutating = (ctx) => ctx && (ctx.startPending || ctx.advancePending || ctx.stopPending);
  const finished = (ctx) => Boolean(ctx?.snapshot && terminal.has(ctx.snapshot.status));
  const currentTurn = (ctx) => ctx?.snapshot?.turns.find((turn) => turn.id === ctx.snapshot.current_turn_id);
  const path = (ctx) => `/api/discussion/${encodeURIComponent(ctx.id)}`;
  const roleName = (id) => config?.roles.find((role) => role.id === id)?.name || id;

  function showError(error) {
    ui['page-error'].textContent = error ? message(error) : '';
    ui['page-error'].hidden = !error;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function savePending() {
    // Only an unresolved start and the local stop latch survive a refresh. No token.
    sessionStorage.setItem(storageKey, JSON.stringify({ start: pendingStart, stopId: savedStopId }));
  }

  function saveRecoveryState() {
    try { savePending(); } catch { showError('无法保存恢复状态，请先在本页确认讨论结果再刷新。'); }
  }

  function readyTurn(ctx) {
    const turn = currentTurn(ctx);
    return same(ctx) && !expired && !ctx.localStop && !ctx.queryFailed && ctx.snapshot?.status === 'awaiting_playback'
      && turn?.status === 'ready' && (!Array.isArray(turn.audio_chunks) || turn.audio_complete === true)
      && !turn.discussion_ack ? turn : null;
  }

  function playableTurn(ctx) {
    const turn = currentTurn(ctx);
    return same(ctx) && !expired && !ctx.localStop && !ctx.queryFailed && !finished(ctx)
      && ['running', 'awaiting_playback'].includes(ctx.snapshot?.status) && !turn?.discussion_ack
      && (turn?.status === 'ready' || (turn?.status === 'synthesizing' && Array.isArray(turn.audio_chunks))) ? turn : null;
  }

  function updateControls() {
    const locked = !config || loading || expired || Boolean(pendingStart) || Boolean(session && (!finished(session) || mutating(session)));
    ui['role-fieldset'].disabled = locked;
    ui.topic.disabled = locked;
    for (const [id, nodes] of roleNodes) {
      const order = selected.indexOf(id);
      nodes.input.checked = order >= 0;
      nodes.input.disabled = locked || !nodes.role.available || (selected.length >= 3 && order < 0);
      nodes.order.textContent = order < 0 ? '' : order === 0 ? '1 · 最后总结' : String(order + 1);
    }
    const validSelection = selected.length >= 2 && selected.length <= 3
      && selected.every((id) => config?.roles.some((role) => role.id === id && role.available));
    ui.start.disabled = locked || !validSelection || !ui.topic.value.trim();
    ui.start.textContent = finished(session) ? '开始新讨论 ↗' : '开始讨论 ↗';
    ui['reload-config'].disabled = loading || expired || Boolean(session && (!finished(session) || mutating(session)));
    ui['refresh-page'].hidden = !expired;
    ui['selection-order'].textContent = selected.length
      ? `发言顺序：${selected.map(roleName).join(' → ')}`
      : config?.roles.filter((role) => role.available).length < 2 ? '可用伙伴不足两位，请刷新伙伴状态。' : '请选择 2—3 位可用伙伴；第一位负责最后总结。';
    ui.plan.textContent = validSelection
      ? `两轮各 ${selected.length} 段 + ${roleName(selected[0])}总结，共 ${selected.length * 2 + 1} 段。`
      : '每位发言两轮，第一位最后总结共同点与分歧，共 5—7 段。';
    const ready = readyTurn(session);
    const canAct = ready && !mutating(session) && !session.ack;
    ui.play.disabled = !playIntent?.replay && (!playableTurn(session) || Boolean(mutating(session)) || Boolean(session?.ack));
    ui.skip.disabled = !canAct;
    ui.play.textContent = playIntent ? '暂停播放' : '播放本段';
    ui.stop.disabled = !session || expired || finished(session) || session.stopPending || session.stopConfirmed;
    ui.stop.textContent = session?.stopPending ? '正在停止…' : session?.localStop && !session.stopConfirmed ? '重试停止讨论' : '停止讨论';
    ui['retry-query'].hidden = !session || !(session.queryFailed || session.startUncertain || session.ack?.failed || session.audioIssue);
    ui['retry-query'].disabled = expired || loading || pollInFlight || Boolean(mutating(session));
    ui['retry-start'].hidden = !session?.startUncertain || session.localStop;
    ui['retry-start'].disabled = expired || pollInFlight || Boolean(mutating(session));
    ui['retry-advance'].hidden = !session?.ack?.failed || session.localStop || finished(session);
    ui['retry-advance'].disabled = !ready || pollInFlight || Boolean(mutating(session));
  }

  function render() {
    updateControls();
    if (!session) return;
    const ctx = session;
    const data = ctx.snapshot;
    ui['discussion-state'].textContent = expired ? '页面已过期' : ctx.localStop && !finished(ctx) ? '已暂停 · 等待停止确认'
      : ctx.queryFailed ? '状态待确认' : data ? statusNames[data.status] : ctx.startPending ? '正在开始' : '正在恢复讨论';
    ui['task-note'].textContent = ctx.localStop || data?.status === 'stopped'
      ? '本页已停止播放和推进；已送达的任务可能继续执行。'
      : ctx.startUncertain ? '开始结果尚未确认。查询或重试都会使用原请求，不会另开一场。'
      : data?.status === 'error' ? '讨论已中止，错误保留在下方；没有自动重试或跳过。'
      : data?.status === 'completed' ? '本场讨论已结束，发言与播放记录保留在这里。'
      : ctx.restored ? '已恢复原讨论。当前音频需点击播放；没有重发开始请求。'
      : '每段完整播放后才进入下一段，也可以明确跳过。';
    ui['discussion-topic'].hidden = !data?.topic;
    ui['discussion-topic'].textContent = data?.topic || '';
    ui['empty-state'].hidden = Boolean(data?.turns.length);
    ui['playback-state'].textContent = ctx.playerLabel;
    if (!data) return;
    for (const [index, turn] of data.turns.entries()) {
      let nodes = turnNodes.get(turn.id);
      if (!nodes) {
        const card = element('li', 'discussion-turn');
        const heading = element('div', 'turn-heading');
        const author = element('strong', '');
        const state = element('span', 'status-pill');
        const meta = element('p', 'turn-meta');
        const text = element('p', 'answer');
        const playback = element('p', 'record-playback');
        const replay = element('button', 'text-button', '重播整段');
        replay.type = 'button';
        replay.addEventListener('click', () => replayTurn(turn.id));
        const error = element('p', 'record-error');
        error.setAttribute('role', 'alert');
        heading.append(author, state);
        card.append(heading, meta, text, playback, error, replay);
        ui.turns.append(card);
        nodes = { card, author, state, meta, text, playback, error, replay };
        turnNodes.set(turn.id, nodes);
      }
      nodes.card.setAttribute('aria-current', turn.id === data.current_turn_id ? 'step' : 'false');
      nodes.author.textContent = turn.role_name || roleName(turn.project);
      nodes.state.textContent = turnStatusNames[turn.status];
      nodes.meta.textContent = `${index + 1} / ${data.total_turns} · ${turn.phase === 'summary' ? '总结' : `第 ${turn.round} 轮`} · ${phaseNames[turn.phase]}${turn.voice_label ? ` · ${turn.voice_label}` : ''}`;
      nodes.text.textContent = turn.text || (turn.status === 'thinking' ? '伙伴正在思考这个话题…' : turn.status === 'synthesizing' ? '正在准备声音…' : '尚无回答文字。');
      nodes.text.classList.toggle('pending', !turn.text);
      const ack = typeof turn.discussion_ack === 'string' ? turn.discussion_ack : turn.discussion_ack?.outcome;
      const recorded = { playing: '服务记录：播放中', completed: '服务记录：已播完', stopped: '服务记录：已停止播放', failed: '服务记录：播放失败' }[turn.playback?.state];
      nodes.playback.textContent = turn.discussion_ack ? (ack === 'skipped' ? '已明确跳过' : ack === 'completed' ? '已播完并确认' : '本段已确认')
        : ctx.playbackLabels.get(turn.id) || recorded || (turn.status === 'ready' ? '语音已就绪 · 尚未确认播放完成' : '等待语音');
      nodes.error.textContent = turn.error || '';
      nodes.error.hidden = !turn.error;
      nodes.replay.hidden = data.status !== 'completed' || turn.status !== 'ready' || !turn.audio_url
        || (Array.isArray(turn.audio_chunks) && turn.audio_complete !== true);
      nodes.replay.disabled = nodes.replay.hidden || expired || ctx.localStop || ctx.queryFailed || Boolean(mutating(ctx));
    }
  }

  async function api(url, body) {
    if (body !== undefined && expired) throw new Error('页面已过期，请刷新页面恢复讨论。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Voice-Token': config.token },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'same-origin', signal: controller.signal, keepalive: body !== undefined
      });
      if (response.status === 403) {
        expired = true;
        clearTimeout(pollTimer);
        if (session) { session.autoplay = false; pausePlayback(session, '页面已过期 · 请刷新后恢复', false); }
        render();
        throw Object.assign(new Error('页面已过期，请刷新页面恢复原讨论，不要重复开始。'), { status: 403 });
      }
      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch {
        if (response.ok) throw new Error('服务返回的 JSON 无法读取，结果尚未确认。');
        data = {};
      }
      if (!response.ok) throw Object.assign(new Error(typeof data.detail === 'string' ? data.detail : `请求失败（HTTP ${response.status}）`), { status: response.status });
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('请求超时，服务端结果尚未确认。');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function invalidateReads(ctx) {
    ctx.revision += 1;
    clearTimeout(pollTimer);
  }

  function useSession(id, restored, payload = null) {
    if (session) pausePlayback(session, '已切换讨论', false);
    clearTimeout(pollTimer);
    loadedTurn = null;
    audio.removeAttribute('src');
    audio.load();
    turnNodes.clear();
    ui.turns.replaceChildren();
    session = { id, restored, payload, snapshot: null, revision: 0,
      startUncertain: Boolean(payload), startPending: false, advancePending: false, stopPending: false,
      localStop: savedStopId === id, stopConfirmed: false, queryFailed: false, readRequested: false,
      autoplay: !restored, attemptedAuto: new Set(), ack: null, feedbackError: '', audioIssue: false,
      reportChain: Promise.resolve(true), playbackLabels: new Map(), playerLabel: '正在读取本场讨论…' };
    updateProgress();
    render();
    return session;
  }

  function acceptSnapshot(ctx, data) {
    if (data.id !== ctx.id || !Object.hasOwn(statusNames, data.status) || !Array.isArray(data.turns)
      || !Array.isArray(data.projects) || data.projects.length < 2 || data.projects.length > 3
      || new Set(data.projects).size !== data.projects.length || typeof data.topic !== 'string'
      || data.total_turns !== data.projects.length * 2 + 1
      || new Set(data.turns.map((turn) => turn.id)).size !== data.turns.length
      || data.turns.some((turn) => typeof turn.id !== 'string' || turn.discussion_id !== ctx.id
        || !data.projects.includes(turn.project) || !Object.hasOwn(turnStatusNames, turn.status) || !Object.hasOwn(phaseNames, turn.phase))
      || (data.current_turn_id && !data.turns.some((turn) => turn.id === data.current_turn_id))) {
      throw new Error('讨论快照与当前请求不匹配，已停止更新，请重新查询。');
    }
    const oldTurnId = ctx.snapshot?.current_turn_id;
    if (ctx.ack) {
      const acknowledged = data.turns.find((turn) => turn.id === ctx.ack.turnId)?.discussion_ack;
      if (acknowledged || terminal.has(data.status) || data.stop_requested) ctx.ack = null;
      else if (data.current_turn_id !== ctx.ack.turnId) throw new Error('缺少上一段确认记录，已暂停推进，请重新查询。');
    }
    ctx.snapshot = data;
    ctx.startUncertain = false;
    ctx.queryFailed = false;
    if (pendingStart?.id === ctx.id) { pendingStart = null; saveRecoveryState(); }
    selected = [...data.projects];
    ui.topic.value = data.topic;
    if (data.stop_requested || ['stopping', 'stopped'].includes(data.status)) {
      ctx.localStop = true;
      ctx.stopConfirmed = true;
      savedStopId = ctx.id;
      saveRecoveryState();
    }
    if (ctx.localStop || terminal.has(data.status)) {
      ctx.autoplay = false;
      pausePlayback(ctx, ctx.localStop ? '已停止播放和推进' : data.status === 'error' ? '讨论失败 · 已停止播放' : '本场讨论已结束');
    } else if (oldTurnId !== data.current_turn_id) {
      pausePlayback(ctx, '等待当前伙伴', false);
      loadedTurn = null;
    }
    const turn = currentTurn(ctx);
    if (loadedTurn === turn?.id) player.update(turn);
    if (!playIntent && !ctx.ack && !ctx.localStop && !finished(ctx)) {
      ctx.playerLabel = turn?.status === 'ready' ? ctx.playbackLabels.get(turn.id) || '语音已就绪 · 点击播放本段'
        : turn ? turnStatusNames[turn.status] : '等待下一位伙伴';
    }
    if (data.error) showError(data.error);
    render();
    finishPlayback();
    if (playableTurn(ctx) && ctx.autoplay && !ctx.ack && !mutating(ctx) && !document.hidden && !ctx.attemptedAuto.has(turn.id)) {
      void playCurrent(false);
    }
  }

  // One GET at a time across all discussions. Mutation revisions discard older
  // reads, and every reschedule rechecks the current session, never a captured ID.
  function schedulePoll(delay = 200) {
    clearTimeout(pollTimer);
    if (!session || disposed || expired || loading || pollInFlight || mutating(session) || (session.queryFailed && !session.readRequested)) return;
    if (!session.readRequested && (session.startUncertain || finished(session))) return;
    pollTimer = setTimeout(poll, delay);
  }

  function requestRead() {
    if (!session || expired || disposed) return;
    session.readRequested = true;
    showError(null);
    schedulePoll(0);
    render();
  }

  async function poll() {
    const ctx = session;
    if (!ctx || pollInFlight || mutating(ctx) || expired || disposed || (ctx.queryFailed && !ctx.readRequested)) return;
    pollInFlight = true;
    ctx.readRequested = false;
    const revision = ctx.revision;
    updateControls();
    try {
      const data = await api(path(ctx));
      if (!same(ctx) || revision !== ctx.revision) return;
      acceptSnapshot(ctx, data);
    } catch (error) {
      if (!same(ctx) || revision !== ctx.revision) return;
      ctx.queryFailed = true;
      ctx.autoplay = false;
      pausePlayback(ctx, '查询失败 · 请重新查询后播放');
      showError(`${message(error)} ${ctx.startUncertain ? '原开始请求已保留，可查询或用同一请求重试。' : '本页已暂停推进，可重新查询状态。'}`);
    } finally {
      pollInFlight = false;
      render();
      schedulePoll(session?.readRequested ? 0 : 200);
    }
  }

  async function loadConfig() {
    if (loading || (session && (!finished(session) || mutating(session)))) return;
    loading = true;
    showError(null);
    updateControls();
    ui['connection-state'].textContent = '正在连接本地语音服务…';
    try {
      const data = await api('/api/config');
      if (disposed) return;
      if (!Array.isArray(data.roles) || data.roles.some((role) => typeof role.id !== 'string' || typeof role.name !== 'string' || typeof role.available !== 'boolean')
        || typeof data.token !== 'string' || !data.token
        || [data.active_discussion, data.last_discussion].some((id) => id != null && typeof id !== 'string')) throw new Error('服务配置缺少伙伴、讨论 ID 或请求令牌。');
      config = data;
      roleNodes.clear();
      ui.roles.replaceChildren(...data.roles.map((role) => {
        const label = element('label', `discussion-role${role.available ? '' : ' unavailable'}`);
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = role.id;
        const copy = element('span', 'role-copy');
        copy.append(element('strong', '', role.name), element('span', 'small-label', [role.voice_label, role.available ? '可用' : '暂不可用', role.detail].filter(Boolean).join(' · ')));
        const order = element('span', 'role-order');
        label.append(input, copy, order);
        input.addEventListener('change', () => {
          if (input.disabled || ui['role-fieldset'].disabled) return;
          selected = selected.filter((id) => id !== role.id);
          if (input.checked && selected.length < 3) selected.push(role.id);
          updateControls();
        });
        roleNodes.set(role.id, { input, order, role });
        return label;
      }));
      ui['connection-state'].textContent = '本地服务已连接';
      const id = data.active_discussion || pendingStart?.id || data.last_discussion;
      if (id) {
        useSession(id, true, pendingStart?.id === id ? pendingStart : null);
        session.readRequested = true;
      } else {
        session = null;
        selected = selected.filter((id) => data.roles.some((role) => role.id === id && role.available));
      }
    } catch (error) {
      config = null;
      ui['connection-state'].textContent = '连接失败';
      showError(error);
    } finally {
      loading = false;
      render();
      schedulePoll(0);
    }
  }

  async function startDiscussion(event) {
    event.preventDefault();
    if (ui.start.disabled) return;
    if (!window.crypto?.randomUUID) { showError('浏览器缺少安全 UUID 支持，请使用 HTTPS 或 localhost。'); return; }
    const payload = { id: crypto.randomUUID(), topic: ui.topic.value.trim(), projects: [...selected], rounds: 2 };
    pendingStart = payload;
    savedStopId = null;
    try { savePending(); } catch {
      pendingStart = null;
      showError('浏览器无法保存待确认请求，尚未开始。请允许此站点使用会话存储后重试。');
      return;
    }
    const ctx = useSession(payload.id, false, payload);
    await sendStart(ctx);
  }

  async function sendStart(ctx) {
    if (!same(ctx) || expired || ctx.localStop || !ctx.startUncertain || mutating(ctx)) return;
    ctx.startPending = true;
    ctx.queryFailed = false;
    invalidateReads(ctx);
    const revision = ctx.revision;
    showError(null);
    render();
    try {
      const data = await api('/api/discussion', ctx.payload);
      if (!same(ctx) || revision !== ctx.revision) return;
      if (data.id !== ctx.id) throw new Error('开始结果的讨论 ID 不匹配。');
      if (Array.isArray(data.turns)) acceptSnapshot(ctx, data);
      else {
        ctx.startUncertain = false;
        pendingStart = null;
        saveRecoveryState();
      }
      ctx.readRequested = true;
    } catch (error) {
      if (!same(ctx) || revision !== ctx.revision) return;
      ctx.autoplay = false;
      ctx.queryFailed = true;
      // A definite rejection permits editing only after refreshing the roster,
      // which also discovers any discussion responsible for a 409 conflict.
      if ([400, 409, 413, 422].includes(error.status)) {
        pendingStart = null;
        saveRecoveryState();
        session = null;
        config = null;
        ui['discussion-state'].textContent = '开始被拒绝';
        ui['task-note'].textContent = '话题已保留。请刷新伙伴状态，再确认当前讨论。';
        ui['playback-state'].textContent = '尚未开始讨论';
      }
      showError(`${message(error)} ${session ? '没有自动重发；请查询状态或用同一请求重试。' : '请刷新伙伴状态。'}`);
    } finally {
      ctx.startPending = false;
      render();
      schedulePoll(0);
    }
  }

  function mediaSnapshot() {
    const snapshot = player.snapshot();
    return { position_seconds: snapshot.position, duration_seconds: snapshot.duration };
  }

  function updateProgress() {
    const snapshot = player.snapshot();
    ui['playback-time'].textContent = clock(snapshot.position) + ' / ' + (snapshot.duration ? clock(snapshot.duration) : '—');
    ui['playback-progress'].value = snapshot.duration > 0 ? Math.min(1, snapshot.position / snapshot.duration) : 0;
  }

  function setPlayback(ctx, turnId, label) {
    ctx.playbackLabels.set(turnId, label);
    ctx.playerLabel = label;
    render();
  }

  function reportPlayback(ctx, turnId, state, snapshot = mediaSnapshot()) {
    // Keep feedback ordered. A stop invalidates queued playing/completed reports.
    ctx.reportChain = ctx.reportChain.then(async () => {
      if (session !== ctx || expired || ((disposed || ctx.localStop) && state !== 'stopped')) return false;
      try {
        await api(`/api/turn/${encodeURIComponent(turnId)}/playback`, { state, ...snapshot });
        return true;
      } catch (error) {
        if (!same(ctx)) return false;
        ctx.feedbackError = `播放状态上报失败：${message(error)}`;
        ctx.autoplay = false;
        if (playIntent?.turnId === turnId) pausePlayback(ctx, '播放上报失败 · 已暂停', false);
        showError(`${ctx.feedbackError} 本段不会自动推进。`);
        render();
        return false;
      }
    });
    return ctx.reportChain;
  }

  function pausePlayback(ctx, label, report = true) {
    const intent = playIntent;
    const snapshot = mediaSnapshot();
    playIntent = null;
    player.stop();
    ctx.playerLabel = label;
    if (intent?.ctx === ctx) {
      ctx.playbackLabels.set(intent.turnId, label);
      if (report) void reportPlayback(ctx, intent.turnId, 'stopped', snapshot);
    }
    updateProgress();
  }

  function validIntent(intent) {
    return intent && same(intent.ctx) && playIntent === intent && !intent.ctx.localStop && !expired
      && !intent.ctx.queryFailed && player.id === intent.turnId
      && (intent.replay ? intent.ctx.snapshot?.status === 'completed' : currentTurn(intent.ctx)?.id === intent.turnId);
  }

  function replayTurn(turnId) {
    const ctx = session;
    const turn = ctx?.snapshot?.turns.find((item) => item.id === turnId);
    if (!same(ctx) || expired || ctx.localStop || ctx.queryFailed || mutating(ctx) || ctx.snapshot.status !== 'completed'
      || turn?.status !== 'ready' || !turn.audio_url || (Array.isArray(turn.audio_chunks) && turn.audio_complete !== true)) return;
    pausePlayback(ctx, '正在重播整段');
    player.select(turn);
    loadedTurn = turn.id;
    if (player.fatal) { showError('整段音频不可用。'); render(); return; }
    showError(null);
    playIntent = { ctx, turnId: turn.id, reported: false, replay: true };
    player.start({ replay: true });
    render();
  }

  function playCurrent(explicit) {
    const ctx = session;
    const turn = playableTurn(ctx);
    if (!turn || mutating(ctx) || ctx.ack || playIntent) return;
    if (explicit) { ctx.autoplay = true; ctx.restored = false; ctx.feedbackError = ''; }
    ctx.attemptedAuto.add(turn.id);
    showError(null);
    if (loadedTurn !== turn.id || player.fatal) {
      player.select(turn);
      loadedTurn = turn.id;
    } else player.update(turn);
    if (player.fatal) {
      ctx.autoplay = false;
      ctx.audioIssue = true;
      setPlayback(ctx, turn.id, '音频不可用 · 请重新查询或明确跳过');
      showError('音频分块或地址无效，未播放、未推进。');
      return;
    }
    ctx.audioIssue = false;
    playIntent = { ctx, turnId: turn.id, reported: false, finished: false };
    player.start();
    render();
  }

  // The final chunk may end before the service marks the discussion awaiting.
  // Keep the intent alive and recheck on each accepted snapshot, never advance
  // on turn.ready alone or on an ended event from a superseded source.
  function finishPlayback() {
    const intent = playIntent;
    if (validIntent(intent) && !intent.replay && intent.finished && readyTurn(intent.ctx) && !mutating(intent.ctx) && !intent.ctx.ack) {
      void acknowledge('completed');
    }
  }

  function playbackState(state, snapshot, error) {
    const intent = playIntent;
    if (!validIntent(intent)) return;
    const ctx = intent.ctx;
    if (state === 'playing') {
      setPlayback(ctx, intent.turnId, '正在播放 · 尚未播完');
      if (!intent.reported) { intent.reported = true; void reportPlayback(ctx, intent.turnId, 'playing'); }
    } else if (state === 'completed') {
      if (intent.replay) {
        playIntent = null;
        void reportPlayback(ctx, intent.turnId, 'completed');
        setPlayback(ctx, intent.turnId, '整段音频已重播');
      } else {
        intent.finished = true;
        setPlayback(ctx, intent.turnId, '本段已播完 · 等待服务确认');
        finishPlayback();
      }
    } else if (state === 'failed') {
      ctx.autoplay = false;
      ctx.audioIssue = true;
      const blocked = error.name === 'NotAllowedError';
      pausePlayback(ctx, blocked ? '自动播放被阻止 · 请点击播放本段' : '播放失败 · 请查看错误', false);
      void reportPlayback(ctx, intent.turnId, 'failed', { position_seconds: snapshot.position, duration_seconds: snapshot.duration });
      showError(blocked ? '浏览器阻止了自动播放，请点击“播放本段”。讨论停留在本段。' : '播放失败：' + message(error));
    } else if (state === 'paused') {
      ctx.autoplay = false;
      pausePlayback(ctx, '播放已暂停 · 点击继续本段');
    } else {
      setPlayback(ctx, intent.turnId, ({ loading: '正在载入音频…', waiting: '等待后续音频 · 尚未播完', buffering: '音频缓冲中 · 尚未播完' })[state]);
    }
    render();
  }

  async function acknowledge(outcome) {
    const ctx = session;
    const turn = readyTurn(ctx);
    if (!turn || mutating(ctx) || ctx.ack) return;
    const snapshot = loadedTurn === turn.id ? mediaSnapshot() : { position_seconds: 0, duration_seconds: 0 };
    if (outcome === 'skipped') { ctx.autoplay = true; ctx.restored = false; ctx.feedbackError = ''; }
    pausePlayback(ctx, outcome === 'completed' ? '本段已播完 · 正在确认' : '已选择跳过 · 正在确认', false);
    ctx.ack = { turnId: turn.id, outcome, snapshot, failed: false };
    await sendAdvance(ctx);
  }

  async function sendAdvance(ctx, explicitRetry = false) {
    const turn = readyTurn(ctx);
    const ack = ctx.ack;
    if (!turn || !ack || ack.turnId !== turn.id || mutating(ctx)) return;
    if (explicitRetry) ctx.feedbackError = '';
    ack.failed = false;
    ctx.advancePending = true;
    invalidateReads(ctx);
    const revision = ctx.revision;
    showError(null);
    render();
    try {
      const reported = await reportPlayback(ctx, turn.id, ack.outcome === 'completed' ? 'completed' : 'stopped', ack.snapshot);
      if (!same(ctx) || ctx.localStop || revision !== ctx.revision) return;
      if (!reported || ctx.feedbackError) throw new Error(ctx.feedbackError || '播放状态未确认。');
      const data = await api(`${path(ctx)}/advance`, { turn_id: ack.turnId, outcome: ack.outcome });
      if (!same(ctx) || ctx.localStop || revision !== ctx.revision) return;
      if (data.id !== undefined && data.id !== ctx.id) throw new Error('推进响应的讨论 ID 不匹配。');
      if (Array.isArray(data.turns)) acceptSnapshot(ctx, data);
      ctx.readRequested = true;
    } catch (error) {
      if (!same(ctx) || ctx.localStop || revision !== ctx.revision) return;
      ack.failed = true;
      ctx.queryFailed = true;
      ctx.autoplay = false;
      showError(`${message(error)} 本段确认结果待核实；请先查询，再重试同一段确认。`);
    } finally {
      ctx.advancePending = false;
      render();
      schedulePoll(0);
    }
  }

  async function stopDiscussion() {
    const ctx = session;
    if (!ctx || expired || finished(ctx) || ctx.stopPending || ctx.stopConfirmed) return;
    ctx.localStop = true;
    ctx.autoplay = false;
    ctx.stopPending = true;
    savedStopId = ctx.id;
    invalidateReads(ctx);
    pausePlayback(ctx, '已停止播放和推进');
    showError(null);
    saveRecoveryState();
    render();
    try {
      const data = await api(`${path(ctx)}/stop`, {});
      if (!same(ctx)) return;
      acceptSnapshot(ctx, data);
      ctx.readRequested = !finished(ctx);
    } catch (error) {
      if (!same(ctx)) return;
      ctx.queryFailed = true;
      showError(`本页已暂停，服务端停止结果尚未确认：${message(error)} 请查询或重试停止；已送达的任务可能继续执行。`);
    } finally {
      ctx.stopPending = false;
      render();
      schedulePoll(0);
    }
  }

  ui['discussion-form'].addEventListener('submit', (event) => { void startDiscussion(event); });
  ui.topic.addEventListener('input', updateControls);
  ui['reload-config'].addEventListener('click', () => { void loadConfig(); });
  ui['refresh-page'].addEventListener('click', () => location.reload());
  ui['retry-query'].addEventListener('click', requestRead);
  ui['retry-start'].addEventListener('click', () => { if (session) void sendStart(session); });
  ui['retry-advance'].addEventListener('click', () => { if (session) void sendAdvance(session, true); });
  ui.play.addEventListener('click', () => {
    if (ui.play.disabled) return;
    if (playIntent) { session.autoplay = false; pausePlayback(session, '已暂停 · 点击继续播放'); render(); }
    else void playCurrent(true);
  });
  ui.skip.addEventListener('click', () => { if (!ui.skip.disabled) void acknowledge('skipped'); });
  ui.stop.addEventListener('click', () => { void stopDiscussion(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !session) return;
    session.autoplay = false;
    pausePlayback(session, '页面已隐藏 · 返回后点击播放');
    render();
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(pollTimer);
    if (session) { session.autoplay = false; pausePlayback(session, '页面已离开'); }
    disposed = true;
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });

  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (saved?.start && typeof saved.start.id === 'string' && typeof saved.start.topic === 'string'
      && Array.isArray(saved.start.projects) && saved.start.projects.length >= 2 && saved.start.projects.length <= 3
      && saved.start.projects.every((id) => typeof id === 'string') && saved.start.rounds === 2) pendingStart = saved.start;
    if (typeof saved?.stopId === 'string') savedStopId = saved.stopId;
  } catch { /* A fresh page can still observe config; start verifies storage before sending. */ }
  void loadConfig();
})();
