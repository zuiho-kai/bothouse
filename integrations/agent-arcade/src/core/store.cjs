'use strict';
const { EVENTS, validEvent } = require('./events.cjs');
const active = new Set(['running', 'waiting', 'error']);
const states = new Set(['idle', 'running', 'waiting', 'error', 'unknown', 'done', 'ended']);
const boundedText = (v, limit = 180) => typeof v === 'string' && v.length <= limit;
const timestamp = v => Number.isSafeInteger(v) && v > 0;
const pendingLimit = 100;
const pendingOverflow = 'unknown:overflow';
const inputTools = new Set(['AskUserQuestion', 'ExitPlanMode']);
// An elicitation dialog has no tool ID. This marker keeps its wait open until
// the dialog itself resolves, whatever unrelated tools finish meanwhile.
const elicitationPending = 'notice:elicitation';
const turnEvents = new Set(['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'Stop', 'SubagentStop', 'StopFailure']);
function boundedPending(values) {
  const ids = Array.isArray(values) ? [...new Set(values.filter(v => boundedText(v)))] : [];
  if (ids.length <= pendingLimit && !ids.includes(pendingOverflow)) return ids;
  // Keep an unresolved marker when old requests cannot all be retained. Their
  // absence from the bounded list is not evidence that permission was granted.
  return [...ids.filter(id => id !== pendingOverflow).slice(-(pendingLimit - 1)), pendingOverflow];
}
function restoreTask(t) {
  if (!t || typeof t !== 'object' || !boundedText(t.session) || !t.session || !boundedText(t.agent) ||
    t.id !== JSON.stringify([t.session, t.agent]) || !states.has(t.state) ||
    !['project', 'name', 'reason'].every(k => boundedText(t[k])) || !timestamp(t.createdAt) || !timestamp(t.updatedAt)) return null;
  // A partial/corrupt local save must not crash the renderer or resurrect
  // arbitrary fields. Retain well-formed stations and discard bad entries.
  const ids = values => Array.isArray(values) ? values.filter(v => boundedText(v)).slice(-100) : [];
  const waitFor = boundedPending(t.waitFor);
  const uncertain = waitFor.includes(pendingOverflow) && !['done', 'ended'].includes(t.state);
  const newUncertainty = uncertain && (t.state !== 'unknown' || t.reason !== 'permission_unknown' ||
    !Array.isArray(t.waitFor) || !t.waitFor.includes(pendingOverflow) || t.waitFor.length > pendingLimit);
  return { id: t.id, session: t.session, agent: t.agent, state: uncertain ? 'unknown' : t.state, project: t.project,
    name: t.name, reason: uncertain ? 'permission_unknown' : t.reason, createdAt: t.createdAt, updatedAt: t.updatedAt,
    lastEvent: EVENTS.includes(t.lastEvent) ? t.lastEvent : '', tool: boundedText(t.tool) ? t.tool : '',
    result: typeof t.result === 'string' ? t.result.slice(0, 16000) : '', acknowledged: !newUncertainty && t.acknowledged === true,
    tools: ids(t.tools), waitFor, questionFor: ids(t.questionFor).filter(id => waitFor.includes(id)), finishedTools: ids(t.finishedTools),
    calls: Array.isArray(t.calls) ? t.calls.filter(c => c && boundedText(c.id) && boundedText(c.key) && /^[a-f0-9]{64}$/.test(c.key)).slice(-100).map(c => ({ id: c.id, key: c.key, inferredPermission: c.inferredPermission === true })) : [],
    history: Array.isArray(t.history) ? t.history.filter(h => h && EVENTS.includes(h.event) && timestamp(h.at) && states.has(h.state) && boundedText(h.tool)).slice(-30) : [] };
}
class Store {
  constructor(saved = {}) {
    if (!saved || typeof saved !== 'object') saved = {};
    this.tasks = new Map((Array.isArray(saved.tasks) ? saved.tasks : []).slice(-200).map(restoreTask).filter(Boolean).map(t => [t.id, t]));
    this.seen = new Set(Array.isArray(saved.seen) ? saved.seen.filter(v => boundedText(v)).slice(-2000) : []);
    this.lastEventAt = timestamp(saved.lastEventAt) ? saved.lastEventAt : 0;
  }
  apply(e) {
    if (!validEvent(e) || this.seen.has(e.id)) return null;
    this.seen.add(e.id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
    this.lastEventAt = Math.max(this.lastEventAt, e.at);
    const id = JSON.stringify([e.session, e.agent || '']);
    const old = this.tasks.get(id);
    if (old && e.at < old.updatedAt && old.state !== 'ended') return this.late(old, e);
    if (old && e.at < old.updatedAt) return null;
    // Hooks racing a close must not reopen it; only a real resume does.
    if (old && old.state === 'ended' && !['SessionStart', 'UserPromptSubmit'].includes(e.event)) return null;
    // idle_prompt is a reminder 60s AFTER a response, not a request for approval.
    // Turning it into waiting would re-alert for a turn that already ended.
    if (e.event === 'Notification' && !['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input', 'quota_auto_resume_stale', 'quota_auto_resume_fired', 'elicitation_complete', 'elicitation_response'].includes(e.notification)) return null;
    const task = old ? structuredClone(old) : { id, session: e.session, agent: e.agent, project: e.project, name: e.agentType || 'Claude', state: 'idle', reason: 'session_ready', createdAt: e.at, updatedAt: e.at, history: [], result: '', tools: [], acknowledged: false };
    task.waitFor ||= []; task.questionFor ||= []; task.finishedTools ||= []; task.calls ||= [];
    if (['PreToolUse','PermissionRequest'].includes(e.event) && e.toolId && task.finishedTools.includes(e.toolId)) return null;
    task.project = e.project; task.updatedAt = e.at; task.lastEvent = e.event;
    const set = (state, reason) => { task.state = state; task.reason = reason; };
    const unresolved = () => task.waitFor.some(id => id === 'unknown' || id.startsWith('unknown:'));
    const waitingReason = () => task.questionFor.some(id => task.waitFor.includes(id)) ? 'question' : 'permission';
    const afterTool = (state, reason) => set(unresolved() ? 'unknown' : task.waitFor.length ? 'waiting' : state, unresolved() ? 'permission_unknown' : task.waitFor.length ? waitingReason() : reason);
    switch (e.event) {
      case 'SessionStart': set('idle', 'session_ready'); task.tools = []; task.waitFor = []; task.questionFor = []; task.finishedTools = []; task.calls = []; break;
      case 'UserPromptSubmit': set('running', 'working'); task.result = ''; task.tools = []; task.waitFor = []; task.questionFor = []; task.finishedTools = []; task.calls = []; break;
      case 'SubagentStart': set('running', 'working'); break;
      case 'PreToolUse':
        if (e.toolId && !task.tools.includes(e.toolId)) task.tools.push(e.toolId);
        if (e.toolId && e.toolKey && !task.calls.some(c => c.id === e.toolId)) {
          const identical = task.calls.filter(c => c.key === e.toolKey);
          // An identical concurrent call makes an earlier ID-less permission
          // ambiguous too. Never clear it by guessing which call it belonged to.
          if (identical.some(c => c.inferredPermission && task.waitFor.includes(c.id))) {
            task.waitFor = task.waitFor.filter(id => !identical.some(c => c.inferredPermission && c.id === id));
            task.waitFor.push(`unknown:${e.toolKey}`);
          }
          task.calls.push({ id: e.toolId, key: e.toolKey });
        }
        task.calls = task.calls.slice(-100);
        if (inputTools.has(e.tool)) {
          const pending = e.toolId || 'unknown';
          if (!task.waitFor.includes(pending)) task.waitFor.push(pending);
          if (!task.questionFor.includes(pending)) task.questionFor.push(pending);
        }
        afterTool('running', 'tool_running');
        if (inputTools.has(e.tool) && e.toolId && task.waitFor.includes(e.toolId)) set('waiting', 'question');
        break;
      case 'PermissionRequest': {
        const candidates = e.toolKey ? task.calls.filter(c => c.key === e.toolKey) : [];
        const pending = e.toolId || (candidates.length === 1 ? candidates[0].id : e.toolKey ? `unknown:${e.toolKey}` : 'unknown');
        if (!e.toolId && candidates.length === 1) candidates[0].inferredPermission = true;
        if (!task.waitFor.includes(pending)) task.waitFor.push(pending);
        if (inputTools.has(e.tool) && !task.questionFor.includes(pending)) task.questionFor.push(pending);
        set('waiting', waitingReason()); break;
      }
      case 'Notification':
        if (e.notification === 'quota_auto_resume_fired') afterTool('running', 'working');
        else if (['elicitation_complete', 'elicitation_response'].includes(e.notification)) {
          // These notifications resolve only an elicitation, not other approvals.
          if (task.reason !== 'question' && !task.waitFor.includes(elicitationPending)) return null;
          task.waitFor = task.waitFor.filter(id => id !== elicitationPending);
          task.questionFor = task.questionFor.filter(id => id !== elicitationPending);
          afterTool('running', 'working');
        } else {
          if (['elicitation_dialog', 'elicitation_url_dialog'].includes(e.notification)) for (const list of [task.waitFor, task.questionFor]) if (!list.includes(elicitationPending)) list.push(elicitationPending);
          set('waiting', e.notification === 'permission_prompt' ? (task.reason === 'question' ? 'question' : waitingReason()) : ['agent_needs_input', 'quota_auto_resume_stale'].includes(e.notification) ? 'input' : 'question');
        }
        break;
      case 'PostToolUse':
        task.tools = task.tools.filter(x => x !== e.toolId);
        task.calls = task.calls.filter(c => c.id !== e.toolId);
        task.waitFor = task.waitFor.filter(x => x !== e.toolId);
        task.questionFor = task.questionFor.filter(x => x !== e.toolId);
        if (e.toolId) task.finishedTools = [...task.finishedTools,e.toolId].slice(-100);
        afterTool('running', 'working'); break;
      case 'PostToolUseFailure':
        task.tools = task.tools.filter(x => x !== e.toolId);
        task.calls = task.calls.filter(c => c.id !== e.toolId);
        task.waitFor = task.waitFor.filter(x => x !== e.toolId);
        task.questionFor = task.questionFor.filter(x => x !== e.toolId);
        if (e.toolId) task.finishedTools = [...task.finishedTools,e.toolId].slice(-100);
        afterTool(e.interrupted ? 'unknown' : 'error', e.interrupted ? 'interrupted' : 'tool_error'); break;
      case 'StopFailure': set('error', 'turn_error'); task.tools = []; break;
      case 'Stop':
        task.result = e.result; task.tools = [];
        set(e.background ? 'running' : e.scheduled ? 'idle' : 'done', e.background ? 'background' : e.scheduled ? 'scheduled' : 'turn_ended'); break;
      case 'SubagentStop': task.result = e.result; task.tools = []; set('done', 'turn_ended'); break;
      case 'SessionEnd':
        set('ended', 'session_ended'); task.tools = [];
        for (const child of this.tasks.values()) if (child.session === e.session && child.id !== id && active.has(child.state) && child.updatedAt <= e.at) {
          child.state = 'unknown'; child.reason = 'parent_ended'; child.updatedAt = e.at; child.acknowledged = false;
        }
        break;
    }
    if (['Stop','SubagentStop','StopFailure','SessionEnd'].includes(e.event)) { task.waitFor = []; task.questionFor = []; task.calls = []; }
    task.tools = task.tools.slice(-pendingLimit);
    task.waitFor = boundedPending(task.waitFor);
    task.questionFor = task.questionFor.filter(id => task.waitFor.includes(id)).slice(-pendingLimit);
    if (task.waitFor.includes(pendingOverflow)) set('unknown', 'permission_unknown');
    task.tool = e.tool || task.tool || '';
    if (!old || old.state !== task.state || old.reason !== task.reason) task.acknowledged = false;
    task.history.push({ event: e.event, at: e.at, state: task.state, tool: e.tool });
    task.history = task.history.slice(-30);
    this.tasks.set(id, task);
    if (this.tasks.size > 200) {
      const removable = [...this.tasks.values()].sort((a,b) => a.updatedAt - b.updatedAt).find(t => !active.has(t.state)) || this.tasks.values().next().value;
      this.tasks.delete(removable.id);
    }
    return { task, previous: old?.state, previousReason: old?.reason, changed: old?.state !== task.state || old?.reason !== task.reason };
  }
  // A hook that lost the race to disk still reports a fact about its own tool
  // call. Record that fact; never move the session's state back in time.
  late(old, e) {
    if (!e.toolId || !['running', 'waiting'].includes(old.state) || !['PostToolUse', 'PostToolUseFailure', 'PermissionRequest'].includes(e.event)) return null;
    const history = Array.isArray(old.history) ? old.history : [];
    const turnStart = history.findLast(h => turnEvents.has(h.event))?.at ?? history[0]?.at ?? Infinity;
    const finished = old.finishedTools || [];
    if (e.at < turnStart || finished.includes(e.toolId)) return null;
    const task = structuredClone(old);
    task.waitFor ||= []; task.questionFor ||= []; task.tools ||= []; task.calls ||= [];
    if (e.event === 'PermissionRequest') {
      if (task.waitFor.includes(e.toolId)) return null;
      task.waitFor.push(e.toolId);
      if (inputTools.has(e.tool)) task.questionFor.push(e.toolId);
    } else {
      for (const key of ['tools', 'waitFor', 'questionFor']) task[key] = task[key].filter(id => id !== e.toolId);
      task.calls = task.calls.filter(c => c.id !== e.toolId);
      task.finishedTools = [...finished, e.toolId].slice(-100);
    }
    task.waitFor = boundedPending(task.waitFor);
    task.questionFor = task.questionFor.filter(id => task.waitFor.includes(id)).slice(-pendingLimit);
    if (task.waitFor.some(id => id === 'unknown' || id.startsWith('unknown:'))) { task.state = 'unknown'; task.reason = 'permission_unknown'; }
    else if (task.waitFor.length) { task.state = 'waiting'; task.reason = task.questionFor.length ? 'question' : 'permission'; }
    else if (old.state === 'waiting' && (old.waitFor || []).includes(e.toolId)) { task.state = 'running'; task.reason = 'working'; }
    const changed = old.state !== task.state || old.reason !== task.reason;
    if (changed) task.acknowledged = false;
    this.tasks.set(task.id, task);
    return changed ? { task, previous: old.state, previousReason: old.reason, changed } : null;
  }
  snapshot(now = Date.now(), staleMs = 5 * 60 * 1000) {
    return [...this.tasks.values()].map(t => ({ ...t, stale: active.has(t.state) && now - t.updatedAt > staleMs,
      displayState: active.has(t.state) && now - t.updatedAt > staleMs ? 'unknown' : t.state })).sort((a,b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }
  acknowledge(id) { const t = this.tasks.get(id); if (t) t.acknowledged = true; }
  clearFinished() { for (const [id,t] of this.tasks) if (['done','ended'].includes(t.state)) this.tasks.delete(id); }
  export() { return { tasks: [...this.tasks.values()], seen: [...this.seen], lastEventAt: this.lastEventAt }; }
}
module.exports = { Store };
