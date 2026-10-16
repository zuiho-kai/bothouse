'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const ui = Object.fromEntries(['role', 'session-label', 'voice-label', 'connection-state', 'reload-config',
    'page-error', 'record', 'record-label', 'record-time', 'record-limit', 'input-status',
    'message-form', 'draft', 'draft-label', 'transcribe-time', 'send', 'turn-state',
    'task-note', 'empty-state', 'records', 'playback-state', 'playback-time',
    'playback-progress', 'play', 'stop', 'audio'].map((id) => [id, $(id)]));
  const workletURL = new URL('recorder-worklet.js', document.currentScript.src).href;
  const audio = ui.audio; // One media element for every turn and replay.
  let config = null;
  let context = null;
  let workletLoad = null;
  let inputPhase = 'idle';
  let inputGeneration = 0;
  let turnGeneration = 0;
  let playbackGeneration = 0;
  let capture = null;
  let held = null;
  let activeTurn = null;
  let playerTurn = null;
  let playIntent = null;
  let transcriptionMs = null;
  let disposed = false;
  const records = [];

  const busy = () => Boolean(activeTurn && !activeTurn.terminal);
  const seconds = (ms) => typeof ms === 'number' && Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} 秒` : '—';
  const mediaNumber = (n) => Number.isFinite(n) && n >= 0 ? n : 0;
  const clock = (n) => `${Math.floor(mediaNumber(n) / 60)}:${String(Math.floor(mediaNumber(n) % 60)).padStart(2, '0')}`;
  const message = (error) => error instanceof Error ? error.message : String(error);

  function showError(error) {
    ui['page-error'].textContent = error ? message(error) : '';
    ui['page-error'].hidden = !error;
  }

  function updateControls() {
    const locked = busy() || inputPhase !== 'idle';
    const available = config?.roles.find((role) => role.id === ui.role.value)?.available !== false;
    ui['reload-config'].disabled = locked;
    ui.role.disabled = !config || locked;
    ui.draft.disabled = !config || locked;
    ui.send.disabled = !config || !available || locked || !ui.draft.value.trim();
    ui.record.disabled = !config || !available || busy() || ['encoding', 'transcribing'].includes(inputPhase);
    ui.record.setAttribute('aria-pressed', String(inputPhase === 'recording'));
    ui['record-label'].textContent = ({ requesting: '等待麦克风', recording: '松开结束', encoding: '整理录音', transcribing: '正在识别' })[inputPhase] || '按住说话';
    ui.play.disabled = !playerTurn?.audioURL || inputPhase !== 'idle' || Boolean(playIntent);
    ui.stop.disabled = !playIntent && !(busy() && activeTurn.autoplay);
    for (const turn of records) turn.nodes.replay.disabled = !turn.audioURL || inputPhase !== 'idle' || Boolean(playIntent);
    if (busy()) {
      ui['input-status'].textContent = activeTurn.answerReady
        ? '文字已返回。请等声音准备好后，再录音或发送。'
        : '本轮任务仍在执行，请先等回答再录音或发送。';
      ui['task-note'].textContent = activeTurn.autoplay
        ? (activeTurn.answerReady ? '可以先阅读回答，声音准备好后自动播放。' : '任务仍在执行。停止只影响播放，不会取消任务。')
        : (activeTurn.answerReady ? '文字已返回；已关闭本轮自动播放，声音准备好后可手动播放。' : '任务仍在执行；已关闭本轮自动播放，完成后可点播放。');
    }
  }

  // Mutations are never retried. An ambiguous POST /turn is resolved by GET of
  // the same UUID, never by posting again (including after a busy 409).
  async function api(path, options = {}) {
    const { timeout = 20000, ...init } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = new Headers(init.headers);
      if (init.method && init.method !== 'GET') headers.set('X-Voice-Token', config.token);
      const response = await fetch(path, { ...init, headers, signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
      const raw = await response.text();
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch {
        if (response.ok) throw new Error(`服务返回了无效 JSON（HTTP ${response.status}）`);
        body = { detail: raw };
      }
      if (!response.ok) {
        const error = new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}：${JSON.stringify(body.detail ?? body)}`);
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('请求超时，尚未确认服务端结果。');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function loadConfig() {
    if (busy() || inputPhase !== 'idle') return;
    const selectedRole = ui.role.value;
    ui['reload-config'].hidden = true;
    ui['connection-state'].textContent = '连接中';
    showError(null);
    try {
      const data = await api('/api/config');
      if (!Array.isArray(data.roles) || !data.roles.length || data.roles.some((role) => !role.id || typeof role.name !== 'string') || typeof data.token !== 'string' || !data.token) {
        throw new Error('服务配置缺少可用伙伴或请求令牌。');
      }
      config = { ...data, max_record_seconds: Math.min(30, Math.max(1, Number(data.max_record_seconds) || 30)) };
      ui.role.replaceChildren(...data.roles.map((role) => {
        const option = document.createElement('option');
        option.value = role.id;
        option.textContent = role.name + (role.available === false ? '（暂不可用）' : '');
        return option;
      }));
      ui.role.value = data.roles.some((role) => role.id === selectedRole) ? selectedRole : data.default_role;
      updateSessionLabel();
      ui['record-limit'].textContent = String(config.max_record_seconds);
      ui['connection-state'].textContent = '本地服务已连接';
      ui['reload-config'].hidden = false;
      ui['reload-config'].textContent = '刷新伙伴状态';
      ui['input-status'].textContent = '准备好了。按住说话，或直接打字。';
      if (typeof data.active_turn === 'string' && data.active_turn) {
        const role = config.roles.find((item) => item.id === ui.role.value);
        const turn = createTurn(data.active_turn, role, '正在读取原轮次输入…');
        turn.restored = true;
        turn.accepted = true;
        turn.autoplay = false;
        activeTurn = turn;
        turn.nodes.answer.textContent = '正在恢复原轮次，只查询状态，不会重新发送。';
        ui['turn-state'].textContent = '恢复原轮次';
        void pollTurn(turn);
      }
    } catch (error) {
      config = null;
      ui['connection-state'].textContent = '连接失败';
      ui['input-status'].textContent = '连接服务后即可开始。';
      ui['reload-config'].hidden = false;
      showError(error);
    }
    updateControls();
  }

  function updateSessionLabel() {
    const role = config?.roles.find((item) => item.id === ui.role.value);
    ui['session-label'].textContent = role ? `${config.session_label} · ${role.name} · ${role.detail || '接续原会话，语音仅在此展示'}` : '请先选择伙伴';
    ui['voice-label'].textContent = role?.voice_label || config?.voice_label || '';
    updateControls();
  }

  async function unlockAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return Promise.reject(new Error('此浏览器不支持 AudioContext，请使用现代浏览器。'));
    if (!context || context.state === 'closed') {
      context = new AudioContextClass();
      workletLoad = null;
    }
    // Invoke resume and a silent sample synchronously in a user gesture.
    const resumed = context.resume();
    const silent = context.createBufferSource();
    silent.buffer = context.createBuffer(1, 1, context.sampleRate);
    silent.connect(context.destination);
    silent.onended = () => silent.disconnect();
    silent.start();
    return resumed;
  }

  function releaseMic(session) {
    if (!session) return;
    session.stream?.getTracks().forEach((track) => track.stop());
    session.source?.disconnect();
    session.node?.disconnect();
    session.sink?.disconnect();
    clearInterval(session.ticker);
    clearTimeout(session.deadline);
    clearTimeout(session.flushDeadline);
  }

  function captureFailure(session, error) {
    releaseMic(session);
    if (capture !== session || session.generation !== inputGeneration) return;
    inputGeneration += 1;
    capture = null;
    held = null;
    inputPhase = 'idle';
    ui['input-status'].textContent = '录音未完成。可以重新按住，或直接打字。';
    const prefix = error.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器中允许后重试。' : '录音失败：';
    showError(`${prefix} ${message(error)}`);
    updateControls();
  }

  async function startCapture() {
    if (!config || busy() || inputPhase !== 'idle') return;
    stopPlayback();
    showError(null);
    const generation = ++inputGeneration;
    const session = { generation, chunks: [], stream: null, finishing: false };
    capture = session;
    inputPhase = 'requesting';
    ui['record-time'].textContent = '0.0';
    ui['input-status'].textContent = '请允许麦克风，并继续按住；松开即可取消。';
    updateControls();
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('麦克风需要 HTTPS 或 localhost 安全页面。');
      // Attach a rejection handler immediately, even while permission is pending.
      const unlocked = unlockAudio().then(() => null, (error) => error);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      session.stream = stream;
      if (generation !== inputGeneration || !held || disposed) { releaseMic(session); return; }
      const unlockError = await unlocked;
      if (unlockError) throw unlockError;
      if (generation !== inputGeneration || !held || disposed) { releaseMic(session); return; }
      if (!context.audioWorklet || !window.AudioWorkletNode) throw new Error('此浏览器不支持 AudioWorklet 录音。');
      if (!workletLoad) workletLoad = context.audioWorklet.addModule(workletURL).catch((error) => { workletLoad = null; throw error; });
      await workletLoad;
      if (generation !== inputGeneration || !held || disposed) { releaseMic(session); return; }
      session.rate = context.sampleRate;
      session.node = new AudioWorkletNode(context, 'voice-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { maxSeconds: config.max_record_seconds } });
      session.sink = context.createGain();
      session.sink.gain.value = 0;
      session.node.connect(session.sink).connect(context.destination);
      session.node.port.onmessage = ({ data }) => {
        if (capture !== session || generation !== inputGeneration) return;
        if (data.type === 'samples') session.chunks.push(data.samples);
        if (data.type === 'stopped') {
          session.rate = data.sampleRate;
          ui['record-time'].textContent = (data.frames / data.sampleRate).toFixed(1);
          void finishCapture(session);
        }
      };
      session.node.onprocessorerror = () => captureFailure(session, new Error('录音处理器发生错误。'));
      session.source = context.createMediaStreamSource(stream);
      session.source.connect(session.node);
      session.started = performance.now();
      inputPhase = 'recording';
      ui['input-status'].textContent = '正在听，松开后开始识别；不会自动发送。';
      session.ticker = setInterval(() => { ui['record-time'].textContent = Math.min(config.max_record_seconds, (performance.now() - session.started) / 1000).toFixed(1); }, 100);
      // Worklet also enforces the duration by sample count when UI timers stall.
      session.deadline = setTimeout(endCapture, config.max_record_seconds * 1000);
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (capture === session && inputPhase === 'recording') endCapture();
      });
      updateControls();
    } catch (error) { captureFailure(session, error); }
  }

  function endCapture() {
    held = null;
    const session = capture;
    if (!session) return;
    if (inputPhase === 'requesting') {
      inputGeneration += 1;
      capture = null;
      releaseMic(session);
      inputPhase = 'idle';
      ui['input-status'].textContent = '已取消。允许麦克风后，请重新按住说话。';
      updateControls();
      return;
    }
    if (inputPhase !== 'recording') return;
    inputPhase = 'encoding';
    // Stop microphone tracks now, but flush the worklet's last partial block.
    session.stream.getTracks().forEach((track) => track.stop());
    clearInterval(session.ticker);
    clearTimeout(session.deadline);
    session.node.port.postMessage({ type: 'stop' });
    session.flushDeadline = setTimeout(() => captureFailure(session, new Error('录音处理器未能完成收尾，请重新录音。')), 2000);
    ui['input-status'].textContent = '录音已停止，正在整理音频…';
    updateControls();
  }

  async function makeWav(chunks, actualRate) {
    const count = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (!count) throw new Error('没有采集到音频，请按住说话后再松开。');
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) throw new Error('此浏览器不支持音频重采样。');
    const length = Math.max(1, Math.floor(count * 16000 / actualRate));
    // Native resampling uses the real source rate and includes low-pass filtering.
    const offline = new OfflineContext(1, length, 16000);
    const input = offline.createBuffer(1, count, actualRate);
    let offset = 0;
    for (const chunk of chunks) { input.copyToChannel(chunk, 0, offset); offset += chunk.length; }
    const source = offline.createBufferSource();
    source.buffer = input;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const pcm = rendered.getChannelData(0);
    const bytes = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(bytes);
    const ascii = (at, value) => [...value].forEach((character, i) => view.setUint8(at + i, character.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }

  async function finishCapture(session) {
    if (session.finishing) return;
    session.finishing = true;
    held = null;
    releaseMic(session);
    inputPhase = 'encoding';
    ui['input-status'].textContent = '录音已停止，正在整理音频…';
    updateControls();
    try {
      const wav = await makeWav(session.chunks, session.rate);
      session.chunks = [];
      if (session.generation !== inputGeneration || disposed) return;
      inputPhase = 'transcribing';
      ui['input-status'].textContent = '正在识别，麦克风已释放。识别后请确认文字。';
      updateControls();
      const result = await api('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, timeout: 180000 });
      if (session.generation !== inputGeneration || disposed) return;
      if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('识别结果为空，请重新录音或直接打字。');
      ui.draft.value = result.text;
      transcriptionMs = result.elapsed_ms;
      ui['transcribe-time'].textContent = `识别 ${seconds(transcriptionMs)}`;
      ui['draft-label'].textContent = '识别结果 · 请确认或修改';
      ui['input-status'].textContent = '识别完成。确认文字后，点击发送。';
      showError(null);
    } catch (error) {
      if (session.generation !== inputGeneration || disposed) return;
      showError(error);
      ui['input-status'].textContent = '识别未完成，原输入已保留。可重录或直接打字。';
    } finally {
      if (capture === session && session.generation === inputGeneration) {
        capture = null; inputPhase = 'idle'; updateControls();
      }
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createTurn(id, role, text) {
    const turn = { id, role, text, transcriptionMs, generation: ++turnGeneration, terminal: false, autoplay: true, audioURL: null, reportChain: Promise.resolve(), played: false };
    const card = element('article', 'turn-card');
    const heading = element('div', 'turn-heading');
    const roleName = element('strong', '', role.name);
    heading.append(roleName, element('span', 'turn-meta', new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })));
    const prompt = element('p', 'user-text', `你：${text}`);
    const answer = element('p', 'answer pending', '正在提交本轮消息…');
    const timings = element('p', 'timings');
    const playback = element('p', 'record-playback', '尚未生成语音');
    const error = element('p', 'record-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const reportError = element('p', 'record-error'); reportError.hidden = true; reportError.setAttribute('role', 'alert');
    const notice = element('p', 'turn-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
    const memoryWarning = element('p', 'record-error'); memoryWarning.hidden = true; memoryWarning.setAttribute('role', 'alert');
    const retry = element('button', 'secondary-button retry-status', '重新查询本轮状态'); retry.type = 'button'; retry.hidden = true;
    retry.addEventListener('click', () => { if (activeTurn === turn && !turn.polling) void pollTurn(turn); });
    const replay = element('button', 'text-button record-play', '播放这轮回答'); replay.type = 'button'; replay.hidden = true;
    replay.addEventListener('click', () => { if (inputPhase === 'idle') { void unlockAudio().catch(() => {}); void playTurn(turn); } });
    card.append(heading, prompt, answer, timings, playback, notice, memoryWarning, error, reportError, retry, replay);
    turn.nodes = { card, roleName, prompt, answer, timings, playback, notice, memoryWarning, error, reportError, retry, replay };
    ui.records.prepend(card);
    ui['empty-state'].hidden = true;
    ui.records.scrollTop = 0;
    records.unshift(turn);
    if (records.length > 12) records.pop().nodes.card.remove();
    setTimings(turn, {});
    return turn;
  }

  function setTimings(turn, timings) {
    turn.nodes.timings.replaceChildren(...[
      ['识别', turn.transcriptionMs], ['模型', timings.agent_ms], ['合成', timings.tts_ms], ['总计', timings.total_ms]
    ].map(([label, value]) => element('span', '', `${label} ${seconds(value)}`)));
  }

  function setTurnError(turn, error) {
    turn.nodes.error.textContent = error ? message(error) : '';
    turn.nodes.error.hidden = !error;
  }

  const currentTurn = (turn) => !disposed && activeTurn === turn && turn.generation === turnGeneration;

  function acceptTurn(turn) {
    if (turn.accepted) return;
    turn.accepted = true;
    ui.draft.value = '';
    transcriptionMs = null;
    ui['transcribe-time'].textContent = '';
    ui['draft-label'].textContent = '也可以直接打字';
  }

  async function sendTurn(event) {
    event.preventDefault();
    if (!config || busy() || inputPhase !== 'idle' || !ui.draft.value.trim()) return;
    showError(null);
    if (!window.crypto?.randomUUID) { showError('此浏览器缺少安全 UUID 支持，请使用 HTTPS 或 localhost。'); return; }
    const role = config.roles.find((item) => item.id === ui.role.value);
    if (!role) { showError('请选择后端提供的伙伴。'); return; }
    if (role.available === false) { showError(role.detail || '这位伙伴暂不可用，请刷新状态。'); return; }
    void unlockAudio().catch(() => {});
    const previousPlayback = playerTurn;
    stopPlayback();
    const text = ui.draft.value.trim();
    const turn = createTurn(crypto.randomUUID(), role, text);
    activeTurn = turn;
    ui['turn-state'].textContent = '正在提交';
    updateControls();
    try {
      // The next prompt must observe the stop report, not stale 'playing' state.
      await previousPlayback?.reportChain;
      if (!currentTurn(turn)) return;
      const result = await api('/api/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: turn.id, project: role.id, text }) });
      if (!currentTurn(turn)) return;
      if (result.id !== turn.id) throw new Error('服务返回的轮次 ID 不匹配，提交结果待核实。');
      acceptTurn(turn);
      void pollTurn(turn);
    } catch (error) {
      if (!currentTurn(turn)) return;
      if (error.status >= 400 && error.status < 500) {
        turn.terminal = true;
        turn.nodes.answer.textContent = error.status === 409 ? '服务正忙，本轮未发送。没有排队或自动重试。' : '本轮请求被服务拒绝，输入已保留。';
        setTurnError(turn, error);
        ui['turn-state'].textContent = '请求被拒绝';
        ui['task-note'].textContent = '本轮未进入任务。输入已保留，稍后可自行发送。';
        ui['input-status'].textContent = '输入已保留。';
      } else {
        setTurnError(turn, `提交结果尚未确认：${message(error)} 将只查询此轮状态，不会重复发送。`);
        void pollTurn(turn, true);
      }
      updateControls();
    }
  }

  async function pollTurn(turn, preserveError = false) {
    if (!currentTurn(turn) || turn.terminal || turn.polling) return;
    turn.polling = true;
    turn.nodes.retry.hidden = true;
    if (!preserveError) setTurnError(turn, null);
    try {
      while (currentTurn(turn) && !turn.terminal) {
        const result = await api(`/api/turn/${encodeURIComponent(turn.id)}`);
        if (!currentTurn(turn)) return;
        if (result.id !== turn.id) throw new Error('查询返回了不匹配的轮次，已停止更新。');
        if (turn.restored && !turn.restoredDetails) {
          const role = config.roles.find((item) => item.id === result.project);
          if (!role) throw new Error('原轮次的伙伴不在当前可用配置中，已停止更新。');
          turn.role = role;
          turn.nodes.roleName.textContent = role.name;
          turn.nodes.prompt.textContent = typeof result.input_text === 'string' ? `你：${result.input_text}` : '已恢复原轮次；服务未提供原输入文字。';
          ui.role.value = role.id;
          updateSessionLabel();
          turn.restoredDetails = true;
        }
        if (result.project !== turn.role.id) throw new Error('查询返回了不匹配的伙伴，已停止更新。');
        turn.nodes.notice.textContent = result.notice ? String(result.notice) : '';
        turn.nodes.notice.hidden = !result.notice;
        if (result.memory_warning) {
          // Keep this warning even if a later response omits it or playback succeeds.
          turn.nodes.memoryWarning.textContent = `共享记录警告：${String(result.memory_warning)}`;
          turn.nodes.memoryWarning.hidden = false;
        }
        if (!['thinking', 'synthesizing', 'ready', 'error'].includes(result.status)) throw new Error(`未知轮次状态：${String(result.status)}`);
        acceptTurn(turn);
        setTurnError(turn, null);
        setTimings(turn, result.timings || {});
        if (result.status === 'thinking' || result.status === 'synthesizing') {
          ui['turn-state'].textContent = result.status === 'thinking' ? '正在思考' : '正在合成语音';
          // Synthesizing starts only after the bridge returns a completed answer.
          // Thinking/intermediate output must still never be shown as final text.
          turn.answerReady = result.status === 'synthesizing' && typeof result.text === 'string' && Boolean(result.text.trim());
          turn.nodes.answer.classList.toggle('pending', !turn.answerReady);
          turn.nodes.answer.textContent = turn.answerReady ? result.text
            : (result.status === 'thinking' ? '伙伴正在处理这轮消息…' : '正在准备声音…');
          turn.nodes.playback.textContent = result.status === 'synthesizing' ? '正在准备声音 · 尚未播放' : '尚未生成语音';
          updateControls();
          await new Promise((resolve) => { turn.pollWake = resolve; turn.pollTimer = setTimeout(resolve, 1000); });
          turn.pollWake = null;
          continue;
        }
        turn.terminal = true;
        turn.nodes.answer.classList.remove('pending');
        turn.nodes.answer.textContent = typeof result.text === 'string' ? result.text : '';
        ui['input-status'].textContent = '可以继续录音，或直接打字。';
        if (result.status === 'error') {
          setTurnError(turn, result.error || '服务返回 error，但未提供错误详情。');
          turn.nodes.playback.textContent = '本轮失败，未播放';
          ui['turn-state'].textContent = '本轮失败';
          ui['task-note'].textContent = '具体错误已保留在本轮记录中。';
        } else {
          ui['turn-state'].textContent = '回答已生成';
          ui['task-note'].textContent = '回答已生成；播放进度和完成情况单独记录。';
          if (typeof result.text !== 'string' || !result.text.trim()) {
            setTurnError(turn, '服务返回 ready，但没有最终回答文字，未播放音频。');
            turn.nodes.playback.textContent = '无最终文字，未播放';
          } else {
            turn.audioURL = new URL(result.audio_url || `/api/turn/${encodeURIComponent(turn.id)}/audio`, location.href).href;
            turn.nodes.playback.textContent = '语音已生成 · 尚未播放';
            turn.nodes.replay.hidden = false;
            selectAudio(turn);
            if (turn.autoplay && !document.hidden) void playTurn(turn);
            else setPlayback(turn, '语音已生成 · 点击播放');
          }
        }
        updateControls();
      }
    } catch (error) {
      if (!currentTurn(turn)) return;
      if (turn.terminal) {
        turn.audioURL = null;
        setTurnError(turn, `回答已返回，但音频无法载入：${message(error)}`);
        turn.nodes.playback.textContent = '音频不可用 · 请看回答文字';
        ui['turn-state'].textContent = '音频不可用';
        return;
      }
      // A failed status read cannot establish that generation has ended.
      setTurnError(turn, `${message(error)} 尚未确认任务是否结束；仅可重新查询，本页暂不接受新轮次。`);
      turn.nodes.retry.hidden = false;
      ui['turn-state'].textContent = '状态待确认';
    } finally {
      turn.polling = false;
      updateControls();
    }
  }

  function setPlayback(turn, label) {
    turn.nodes.playback.textContent = label;
    if (playerTurn === turn) ui['playback-state'].textContent = label;
  }

  function reportPlayback(turn, state, snapshot) {
    const body = JSON.stringify({ state, position_seconds: snapshot.position, duration_seconds: snapshot.duration });
    // Preserve transition order on the wire; failed reports are not retried.
    turn.reportChain = turn.reportChain.then(() => api(`/api/turn/${encodeURIComponent(turn.id)}/playback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, timeout: 10000 })).catch((error) => {
      turn.nodes.reportError.textContent = `播放状态上报失败（${state}）：${message(error)}`;
      turn.nodes.reportError.hidden = false;
    });
  }

  const mediaSnapshot = () => ({ position: mediaNumber(audio.currentTime), duration: mediaNumber(audio.duration) });

  function updateProgress() {
    ui['playback-time'].textContent = `${clock(audio.currentTime)} / ${Number.isFinite(audio.duration) ? clock(audio.duration) : '—'}`;
    ui['playback-progress'].value = audio.duration > 0 ? Math.min(1, audio.currentTime / audio.duration) : 0;
  }

  function stopPlayback(suppressAutoplay = true) {
    if (suppressAutoplay && busy()) activeTurn.autoplay = false;
    const old = playIntent;
    const snapshot = mediaSnapshot(); // Capture before resetting currentTime.
    playbackGeneration += 1;
    playIntent = null;
    audio.pause();
    try { audio.currentTime = 0; } catch { /* No source/metadata loaded yet. */ }
    if (old) {
      setPlayback(old.turn, `已停止 · 停在 ${clock(snapshot.position)} / ${snapshot.duration ? clock(snapshot.duration) : '—'}`);
      reportPlayback(old.turn, 'stopped', snapshot);
    }
    ui.play.textContent = playerTurn?.played ? '重播回答' : '播放回答';
    updateProgress();
    updateControls();
  }

  function selectAudio(turn) {
    stopPlayback(false);
    playerTurn = turn;
    audio.src = turn.audioURL;
    audio.load();
    ui['playback-state'].textContent = turn.nodes.playback.textContent;
    ui.play.textContent = turn.played ? '重播回答' : '播放回答';
    updateProgress();
    updateControls();
  }

  function validPlayback(intent) {
    return !disposed && intent && playIntent === intent && intent.generation === playbackGeneration && playerTurn === intent.turn && audio.currentSrc === intent.turn.audioURL;
  }

  function playbackFailed(intent, error) {
    if (playIntent !== intent || intent.generation !== playbackGeneration) return;
    const snapshot = mediaSnapshot();
    playIntent = null;
    playbackGeneration += 1;
    audio.pause();
    const blocked = error.name === 'NotAllowedError';
    setPlayback(intent.turn, blocked ? '自动播放被浏览器阻止 · 请点击播放' : '播放失败 · 可点击重新播放');
    setTurnError(intent.turn, `${blocked ? '请点击播放按钮。' : '播放失败：'} ${message(error)}`);
    reportPlayback(intent.turn, 'failed', snapshot);
    updateControls();
  }

  async function playTurn(turn) {
    if (!turn.audioURL || inputPhase !== 'idle' || disposed) return;
    if (playerTurn !== turn || audio.error) selectAudio(turn);
    else stopPlayback(false);
    const intent = { turn, generation: ++playbackGeneration, reported: false };
    playIntent = intent;
    setPlayback(turn, '正在载入音频…');
    updateControls();
    try {
      await audio.play();
      // Superseded play promises must never revive or stop newer playback.
      if (playIntent !== intent || intent.generation !== playbackGeneration) return;
    } catch (error) { playbackFailed(intent, error); }
  }

  audio.addEventListener('playing', () => {
    const intent = playIntent;
    if (!validPlayback(intent) || audio.paused) return;
    intent.turn.played = true;
    setTurnError(intent.turn, null);
    setPlayback(intent.turn, '正在播放 · 尚未播完');
    if (!intent.reported) { intent.reported = true; reportPlayback(intent.turn, 'playing', mediaSnapshot()); }
  });
  audio.addEventListener('ended', () => {
    const intent = playIntent;
    if (!validPlayback(intent) || !audio.ended) return;
    reportPlayback(intent.turn, 'completed', mediaSnapshot());
    setPlayback(intent.turn, '音频已完整播放');
    playIntent = null;
    playbackGeneration += 1;
    ui.play.textContent = '重播回答';
    updateProgress();
    updateControls();
  });
  audio.addEventListener('error', () => {
    if (validPlayback(playIntent) && audio.error) playbackFailed(playIntent, new Error(`音频错误 ${audio.error.code}：${audio.error.message || '音频无法加载或解码'}`));
  });
  audio.addEventListener('pause', () => {
    if (validPlayback(playIntent) && audio.paused && !audio.ended) stopPlayback(false);
  });
  audio.addEventListener('waiting', () => { if (validPlayback(playIntent)) setPlayback(playIntent.turn, '音频缓冲中 · 尚未播完'); });
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', updateProgress);

  ui.record.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || held || ui.record.disabled) return;
    event.preventDefault();
    ui.record.focus({ preventScroll: true });
    held = { type: 'pointer', id: event.pointerId };
    ui.record.setPointerCapture(event.pointerId);
    void startCapture();
  });
  const releasePointer = (event) => { if (held?.type === 'pointer' && held.id === event.pointerId) endCapture(); };
  ui.record.addEventListener('pointerup', releasePointer);
  ui.record.addEventListener('pointercancel', releasePointer);
  ui.record.addEventListener('lostpointercapture', releasePointer);
  ui.record.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target.isContentEditable || (target.closest('input, textarea, select, button, a, [role=button]') && target !== ui.record)) return;
    event.preventDefault();
    if (event.repeat || held || ui.record.disabled) return;
    held = { type: 'keyboard' };
    void startCapture();
  });
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && held?.type === 'keyboard') { event.preventDefault(); endCapture(); }
  });
  window.addEventListener('blur', () => { if (held) endCapture(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (held) endCapture(); stopPlayback(); }
  });
  window.addEventListener('pagehide', () => {
    stopPlayback();
    disposed = true;
    inputGeneration += 1;
    turnGeneration += 1;
    releaseMic(capture);
    if (activeTurn) { clearTimeout(activeTurn.pollTimer); activeTurn.pollWake?.(); }
    void context?.close().catch(() => {});
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
  ui['message-form'].addEventListener('submit', sendTurn);
  ui.draft.addEventListener('input', updateControls);
  ui.role.addEventListener('change', updateSessionLabel);
  ui['reload-config'].addEventListener('click', loadConfig);
  ui.play.addEventListener('click', () => { void unlockAudio().catch(() => {}); if (playerTurn) void playTurn(playerTurn); });
  ui.stop.addEventListener('click', () => stopPlayback());
  void loadConfig();
})();
