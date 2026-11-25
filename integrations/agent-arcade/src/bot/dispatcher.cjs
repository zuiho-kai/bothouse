'use strict';
const crypto = require('node:crypto');
const {isControlText, normalizeControlText} = require('./commands.cjs');
const {ApprovalCodes, SHORT_CODE_LIMIT_MESSAGE} = require('./approval-codes.cjs');

const MAX_TEXT = 6000, MAX_MESSAGES = 60, MAX_QUEUE = 3, REQUEST_TTL = 5 * 60 * 1000;
const outcomes = new Set(['reply_ended', 'error', 'limit', 'cancelled']);
const terminal = task => outcomes.has(task.state);
function redactText(value) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '') : '';
  return text.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|password|secret|token|authorization)["']?\s*[:=]\s*["']?)[^\s"'`,;}\]]+/gi, '$1[redacted]');
}
function clean(value, limit = MAX_TEXT) {
  const redacted = redactText(value);
  return redacted.length <= limit ? redacted : `${redacted.slice(0, Math.max(0, limit - 40))}\n[内容超限，完整结果请在本机查看。]`;
}
function serializeRequest(request) {
  try {
    const value = { tool: request.tool, input: request.input ?? { questions: request.questions } };
    if (request.kind === 'question' && request.questions) value.questions = request.questions;
    const text = JSON.stringify(value);
    // Never authorize a shortened/redacted version of an operation.
    if (!text || Buffer.byteLength(text, 'utf8') > 3000 || clean(text) !== text) return null;
    return text;
  } catch { return null; }
}

class Dispatcher {
  constructor({ execute, send, onChange = () => {}, now = Date.now } = {}) {
    if (typeof execute !== 'function' || typeof send !== 'function') throw new TypeError('execute and send are required');
    this.execute = execute; this.send = send; this.onChange = onChange; this.now = now;
    this.tasks = []; this.messages = []; this.queue = []; this.pending = new Map();
    this.seen = new Set(); this.current = null; this.sessionId = undefined; this.contextToken = undefined;
    this.stopped = false; this.draining = false; this.generation = 0; this.sendChain = Promise.resolve();
    this.drainPromise = Promise.resolve();
    this.failedFinals = new Map();
    this.approvalCodes = new ApprovalCodes({now});
  }

  snapshot() {
    return {
      stopped: this.stopped, hasSession: Boolean(this.sessionId), currentTaskId: this.current?.id || null,
      queue: this.queue.map(task => task.id), deliveryFailed: this.tasks.some(task => task.deliveryFailed),
      tasks: this.tasks.map(task => ({ id: task.id, prompt: clean(task.prompt), state: task.state,
        outcome: task.outcome || null, createdAt: task.createdAt, updatedAt: task.updatedAt,
        activity: clean(task.activity || '', 300), text: clean(task.text || ''), deliveryFailed: task.deliveryFailed })),
      pending: [...this.pending.values()].map(p => ({ code: p.code, alias: p.alias, kind: p.kind, tool: p.tool,
        expiresAt: p.expiresAt, taskId: p.task.id })),
      messages: this.messages.map(message => ({ ...message })),
    };
  }

  _change() {
    try { Promise.resolve(this.onChange(this.snapshot())).catch(() => {}); } catch { /* UI observers cannot interrupt dispatch. */ }
  }

  _message(direction, text, taskId, deliveryFailed = false) {
    const message = { id: crypto.randomUUID(), role: direction === 'incoming' ? 'user' : 'assistant', direction, text: clean(text), at: this.now(), taskId: taskId || null, deliveryFailed };
    this.messages.push(message); this.messages = this.messages.slice(-MAX_MESSAGES); return message;
  }

  _deliver(text, { task, kind = 'status', contextToken = this.contextToken, guard } = {}) {
    const body = clean(text);
    const attempt = this.sendChain.then(async () => {
      if (this.stopped || (guard && !guard())) return false;
      const message = this._message('outgoing', body, task?.id);
      try {
        await this.send(body, contextToken);
        if (task && ['final', 'waiting'].includes(kind)) task.deliveryFailed = false;
        if (task && kind === 'final') this.failedFinals.delete(task.id);
        this._change(); return true;
      } catch {
        message.deliveryFailed = true;
        if (task) task.deliveryFailed = true;
        if (task && kind === 'final') this.failedFinals.set(task.id, body);
        this._change(); return false;
      }
    });
    this.sendChain = attempt.then(() => undefined, () => undefined);
    return attempt;
  }

  async receive({ id, text, contextToken } = {}) {
    if (this.stopped) return { accepted: false, reason: 'stopped' };
    if (!['string', 'number'].includes(typeof id) || !String(id) || String(id).length > 180 || typeof text !== 'string') return { accepted: false, reason: 'invalid' };
    const key = String(id);
    if (this.seen.has(key)) return { accepted: false, duplicate: true };
    // Retain dedupe guarantees for the entire connection rather than forgetting
    // old IDs and accidentally executing a replay. Reconnect after this limit.
    if (this.seen.size >= 10000) return { accepted: false, reason: 'message_limit' };
    this.seen.add(key); this.contextToken = contextToken; this._expire();
    const body = text.trim(); this._message('incoming', body); this._change();
    if (!body || body.length > MAX_TEXT) {
      await this._deliver('消息为空或超过 6000 字符，请缩短后重新发送。'); return { accepted: false, reason: 'invalid_text' };
    }
    if (isControlText(body)) return this._command(normalizeControlText(body));
    const active = [...this.pending.values()];
    if (active.length === 1 && active[0].kind === 'question') {
      this._resolve(active[0], { allow: true, answer: body });
      await this._deliver('已收到回答。', { task: active[0].task }); return { accepted: true, answer: true };
    }
    const bare = this.approvalCodes.identifyBare(body, this.pending);
    if (bare) {
      if (bare.request) await this._sendPending(bare.request, bare.request.kind === 'question'
        ? '这是问题的确认码，不是答案。请按下方提示使用 /answer 确认码 回答。\n\n'
        : '只发送确认码不会批准操作。请核对下方参数，单独发送“同意 确认码”或“拒绝 确认码”。\n\n');
      else await this._deliver('这个确认码已失效，没有批准操作，也没有创建新任务。发送“状态”查看最新提示；确认时请使用“同意 确认码”或“拒绝 确认码”。');
      return {accepted: false, reason: 'bare_confirmation'};
    }
    if (active.length) {
      await this._deliver('还有操作需要你确认。请核对提示后回复“同意 确认码”或“拒绝 确认码”；回答问题用 /answer 确认码 内容。本条消息不会创建新任务。');
      return { accepted: false, reason: 'confirmation_pending' };
    }
    if (this.queue.length >= MAX_QUEUE) {
      await this._deliver('等待队列已满（最多 3 条），请等当前任务结束或使用 /cancel。'); return { accepted: false, reason: 'queue_full' };
    }
    const task = { id: crypto.randomUUID(), prompt: body, state: 'queued', createdAt: this.now(), updatedAt: this.now(), deliveryFailed: false };
    this.tasks.push(task); this.queue.push(task); this._trim(); this._change();
    const ack = this.current ? this._deliver('这条需求已排队，当前任务结束后处理。', { task, kind: 'ack' }) : Promise.resolve(true);
    this._kick(); await ack; return { accepted: true, taskId: task.id };
  }

  async _command(body) {
    const [name] = body.split(/\s/);
    const command = name.toLowerCase();
    if (command === '/status' && body === name) {
      const states = {running:'正在处理你的需求',waiting_permission:'等你确认操作',waiting_question:'等你回答问题',cancelling:'正在停止当前任务'};
      const state = this.current ? `当前：${states[this.current.state] || '正在处理'}` : '当前空闲';
      const waits = [...this.pending.values()].map(p => `待${p.kind === 'question' ? '回答' : '批准'}：${p.tool}，剩余 ${Math.max(0, Math.ceil((p.expiresAt - this.now()) / 1000))} 秒`).join('\n');
      await this._deliver(`${state}\n排队：${this.queue.length}/3\n会话：${this.sessionId ? '将继续上次会话' : '下次新建会话'}${waits ? `\n${waits}` : ''}`);
      // Codes are only sent together with the full bounded operation/question,
      // never in a context-free status summary that could invite blind approval.
      for (const p of this.pending.values()) await this._sendPending(p);
      const last = [...this.failedFinals.entries()].at(-1);
      if (last) await this._deliver(last[1], { task: this.tasks.find(t => t.id === last[0]), kind: 'final' });
      return { accepted: true, status: true };
    }
    if (command === '/new' && body === name) {
      if (this.current || this.queue.length) {
        await this._deliver('当前仍有任务，请先 /cancel 并等本地执行停止，再使用 /new。'); return { accepted: false, reason: 'busy' };
      }
      this.sessionId = undefined; this.generation++; this._change(); await this._deliver('已清除会话上下文，下次任务将新建会话。'); return { accepted: true };
    }
    if (command === '/cancel' && body === name) {
      this._cancel(false); await this._deliver('已清空等待队列并请求中止当前任务。新任务将等本地执行停止后开始。'); return { accepted: true };
    }
    const match = body.match(/^\/(allow|deny|answer)\s+([a-f0-9]{32}|[a-z0-9]{6})(?:\s+([\s\S]+))?$/i);
    if (match) {
      const found = this.approvalCodes.lookup(match[2], this.pending);
      if (found.limited) { await this._deliver(SHORT_CODE_LIMIT_MESSAGE); return {accepted:false,reason:'code_rate_limit'}; }
      const pending = found.request;
      if (!pending || pending.expiresAt <= this.now() || pending.task !== this.current || pending.generation !== this.generation) {
        await this._deliver('确认码无效、已过期或不属于当前任务，未批准任何操作。'); return { accepted: false, reason: 'stale_code' };
      }
      const action = match[1].toLowerCase();
      if (action === 'deny' && !match[3]) this._resolve(pending, { allow: false });
      else if (pending.kind === 'permission' && action === 'allow' && !match[3]) this._resolve(pending, { allow: true });
      else if (pending.kind === 'question' && action === 'answer' && match[3]?.trim()) this._resolve(pending, { allow: true, answer: match[3].trim() });
      else {
        await this._deliver('请单独发送“同意 确认码”或“拒绝 确认码”；回答问题请用 /answer 确认码 回答。不要附加说明或第二条命令。'); return { accepted: false, reason: 'wrong_confirmation' };
      }
      await this._deliver(action === 'deny' ? '已拒绝本次请求。' : '已收到本次确认。', { task: pending.task }); return { accepted: true };
    }
    await this._deliver('可发送“状态”查看进度、“停止”取消当前任务。确认操作请回复“同意 确认码”或“拒绝 确认码”。也支持 /status、/new、/cancel、/allow CODE、/deny CODE、/answer CODE 内容。');
    return { accepted: false, reason: 'unknown_command' };
  }

  _kick() {
    if (this.draining || this.stopped) return;
    this.draining = true;
    // Assign the idle promise before execute/onChange can synchronously trigger
    // disconnect. A replacement dispatcher must wait for the actual runner.
    let settled;
    this.drainPromise = new Promise(resolve => { settled = resolve; });
    this._drain().catch(() => {}).finally(() => {
      this.draining = false; settled();
      if (this.queue.length && !this.stopped) this._kick();
    }).catch(() => {});
  }

  async _drain() {
    while (this.queue.length && !this.stopped) {
      const task = this.queue.shift(); this.current = task;
      const controller = new AbortController(); task.controller = controller; task.state = 'running'; task.updatedAt = this.now(); this._change();
      let result;
      try {
        result = await this.execute({ prompt: task.prompt, resume: this.sessionId, signal: controller.signal,
          onUpdate: update => {
            if (task !== this.current || controller.signal.aborted || this.stopped) return;
            task.activity = clean(typeof update === 'string' ? update : update?.text || update?.tool || '', 300);
            task.updatedAt = this.now(); this._change();
          }, request: request => this._request(task, request) });
      } catch { result = { outcome: controller.signal.aborted ? 'cancelled' : 'error' }; }
      for (const pending of [...this.pending.values()]) if (pending.task === task) this._resolve(pending, { allow: false });
      if (typeof result?.sessionId === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(result.sessionId)) this.sessionId = result.sessionId;
      // A requested cancellation is not proof that a backend process exited.
      // Preserve a runner's explicit failure instead of masking it as cancelled.
      const outcome = result?.outcome === 'error' ? 'error' : controller.signal.aborted || this.stopped ? 'cancelled' : outcomes.has(result?.outcome) ? result.outcome : 'error';
      task.state = task.outcome = outcome; task.updatedAt = this.now();
      task.text = outcome === 'reply_ended' ? clean(result?.text || '本轮没有可显示的回复文本。', MAX_TEXT - 100) : '';
      const labels = { reply_ended: '回复结束（任务结果未验证）', error: '执行出错，请在本机查看详情。任务结果未验证。', limit: '达到执行限制，本轮已停止。任务结果未验证。', cancelled: '本轮已取消。' };
      // Runner notices are bounded protocol diagnostics, never partial model text.
      // In particular, a requested cancellation must not imply a confirmed stop.
      const notice=typeof result?.notice==='string'?clean(result.notice,800):'';
      const final = outcome === 'reply_ended' ? task.text : notice || labels[outcome];
      this.current = null; delete task.controller; this._change();
      if (!this.stopped) void this._deliver(final, { task, kind: 'final' });
    }
  }

  _request(task, request) {
    this._expire();
    if (this.stopped || task !== this.current || task.controller.signal.aborted || request?.signal?.aborted || !['permission', 'question'].includes(request?.kind)) return Promise.resolve({ allow: false });
    const questions = request.questions || request.input?.questions;
    const serialized = serializeRequest(request);
    if (!serialized || typeof request.tool !== 'string' || !request.tool || request.tool.length > 80 || this.pending.size >= 8 ||
      (request.kind === 'permission' && request.input === undefined) ||
      (request.kind === 'question' && (!Array.isArray(questions) || questions.length !== 1 || typeof questions[0]?.question !== 'string'))) {
      void this._deliver('请求过大、格式不受支持或包含敏感参数，已拒绝远程确认。请在本机处理。', { task }); return Promise.resolve({ allow: false });
    }
    const code = crypto.randomBytes(16).toString('hex'), expiresAt = this.now() + REQUEST_TTL;
    return new Promise(resolve => {
      const alias = this.approvalCodes.issue(code);
      const pending = { code, alias, kind: request.kind, tool: clean(request.tool, 80), expiresAt, task, generation: this.generation, resolve };
      pending.message = request.kind === 'permission'
        ? `需要你确认：${request.tool}\n批准后此操作可读取、修改文件或影响本机，请核对完整参数。\n${serialized}\n\n同意 ${alias || code}\n拒绝 ${alias || code}\n确认码 5 分钟内有效，仅限本次请求。`
        : `需要你回答一个问题；回答不会批准其他本机操作。\n${serialized}\n请回复 /answer ${alias || code} 你的回答，或直接回复答案。\n拒绝 ${alias || code}\n确认码 5 分钟内有效。`;
      pending.fullMessage = request.kind === 'permission'
        ? `需要你确认：${request.tool}\n批准后此操作可读取、修改文件或影响本机，请核对完整参数。\n${serialized}\n\n/allow ${code}\n/deny ${code}\n备用完整确认码；有效期仍以原请求为准。`
        : `需要你回答一个问题；回答不会批准其他本机操作。\n${serialized}\n/answer ${code} 你的回答\n/deny ${code}\n备用完整确认码；有效期仍以原请求为准。`;
      pending.timer = setTimeout(() => this._expireOne(pending), REQUEST_TTL); pending.timer.unref?.();
      this.pending.set(code, pending); this._waitingState(task); this._change();
      if (request.signal?.addEventListener) {
        pending.signal = request.signal; pending.abort = () => this._resolve(pending, { allow: false });
        request.signal.addEventListener('abort', pending.abort, { once: true });
      }
      void this._sendPending(pending);
    });
  }

  _sendPending(pending, prefix = '') {
    return this._deliver(prefix + (this.approvalCodes.limited() ? pending.fullMessage : pending.message), { task: pending.task, kind: 'waiting',
      guard: () => this.pending.get(pending.code) === pending && pending.task === this.current &&
        pending.generation === this.generation && pending.expiresAt > this.now() });
  }

  _waitingState(task) {
    if (task.controller.signal.aborted) return;
    const requests = [...this.pending.values()].filter(p => p.task === task);
    task.state = requests.some(p => p.kind === 'permission') ? 'waiting_permission' : requests.length ? 'waiting_question' : 'running';
    task.updatedAt = this.now();
  }

  _resolve(pending, value) {
    if (!this.pending.has(pending.code)) return;
    this.pending.delete(pending.code); clearTimeout(pending.timer);
    if (pending.signal && pending.abort) pending.signal.removeEventListener('abort', pending.abort);
    this._waitingState(pending.task); pending.resolve(value); this._change();
  }

  _expire() {
    for (const pending of [...this.pending.values()]) if (pending.expiresAt <= this.now()) this._expireOne(pending);
  }

  _expireOne(pending) {
    if (!this.pending.has(pending.code)) return;
    this._resolve(pending, { allow: false });
    if (!this.stopped) void this._deliver('确认请求已过期，已拒绝本次操作。', { task: pending.task });
  }

  _cancel(stopping) {
    this.generation++;
    for (const task of this.queue.splice(0)) { task.state = task.outcome = 'cancelled'; task.updatedAt = this.now(); }
    if (this.current) { this.current.state = 'cancelling'; this.current.controller.abort(); }
    for (const pending of [...this.pending.values()]) this._resolve(pending, { allow: false });
    if (stopping) { this.stopped = true; this.contextToken = undefined; }
    this._change();
  }

  stop() { this._cancel(true); }

  whenIdle() { return this.drainPromise; }

  _trim() {
    while (this.tasks.length > 60) {
      const index = this.tasks.findIndex(terminal); if (index < 0) break;
      this.failedFinals.delete(this.tasks[index].id); this.tasks.splice(index, 1);
    }
  }
}
module.exports = { Dispatcher, clean, redactText };
