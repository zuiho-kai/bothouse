'use strict';
const {randomBytes} = require('node:crypto');
const terminal = status => ['completed', 'failed', 'cancelled'].includes(status);

// One local MCP connection, bounded retention. The request body is deliberately
// not retained. Restart drops these inspection tasks; it never replays work.
class BoundedTaskStore {
  constructor({limit = 24, onChange = () => {}, now = Date.now} = {}) {
    this.limit = limit; this.onChange = onChange; this.now = now; this.entries = new Map();
  }
  expire() {
    for (const [id, entry] of this.entries) if (entry.expires <= this.now()) {
      entry.controller.abort(); clearTimeout(entry.timer); this.entries.delete(id);
    }
  }
  lookup(id, sessionId) {
    this.expire(); const entry = this.entries.get(id);
    return entry && entry.sessionId === sessionId ? entry : null;
  }
  async createTask(params, _requestId, _request, sessionId) {
    this.expire();
    if (this.entries.size >= this.limit) throw Error('Inspection task capacity reached; wait for expiry.');
    const ttl = Math.min(300000, Math.max(1000, Number.isFinite(params.ttl) ? params.ttl : 60000));
    const at = new Date(this.now()).toISOString(), taskId = randomBytes(16).toString('hex');
    const task = {taskId, status: 'working', createdAt: at, lastUpdatedAt: at, ttl, pollInterval: 250};
    const entry = {task, sessionId, controller: new AbortController(), expires: this.now() + ttl};
    entry.timer = setTimeout(() => {entry.controller.abort(); this.entries.delete(taskId); this.onChange();}, ttl);
    entry.timer.unref?.(); this.entries.set(taskId, entry); this.onChange(); return {...task};
  }
  signal(id, sessionId) {return this.lookup(id, sessionId)?.controller.signal;}
  async getTask(id, sessionId) {const entry = this.lookup(id, sessionId); return entry ? {...entry.task} : null;}
  async storeTaskResult(id, status, result, sessionId) {
    const entry = this.lookup(id, sessionId);
    if (!entry || terminal(entry.task.status)) throw Error('Task no longer accepts a result.');
    if (!['completed', 'failed'].includes(status)) throw Error('Invalid final task status.');
    entry.result = structuredClone(result);
    entry.task = {...entry.task, status, lastUpdatedAt: new Date(this.now()).toISOString()}; this.onChange();
  }
  async getTaskResult(id, sessionId) {
    const entry = this.lookup(id, sessionId);
    if (!entry || !terminal(entry.task.status)) throw Error('Task result is unavailable.');
    if (entry.task.status === 'cancelled') return {isError: true, content: [{type: 'text', text: 'Text inspection cancelled. No agent process was stopped.'}]};
    return structuredClone(entry.result);
  }
  async updateTaskStatus(id, status, statusMessage, sessionId) {
    const entry = this.lookup(id, sessionId);
    if (!entry || terminal(entry.task.status)) throw Error('Task cannot transition from its current status.');
    if (status !== 'cancelled') throw Error('Only cancellation is supported outside the inspection worker.');
    entry.controller.abort();
    entry.task = {...entry.task, status, statusMessage, lastUpdatedAt: new Date(this.now()).toISOString()}; this.onChange();
  }
  async listTasks(cursor, sessionId) {
    this.expire();
    const tasks = [...this.entries.values()].filter(e => e.sessionId === sessionId).map(e => ({...e.task}));
    const index = cursor ? tasks.findIndex(t => t.taskId === cursor) + 1 : 0;
    if (cursor && index === 0) throw Error('Invalid task cursor.');
    const page = tasks.slice(index, index + 8);
    return {tasks: page, ...(index + 8 < tasks.length ? {nextCursor: page.at(-1).taskId} : {})};
  }
  close() {for (const e of this.entries.values()) {clearTimeout(e.timer); e.controller.abort();} this.entries.clear();}
}
module.exports = {BoundedTaskStore, terminal};
