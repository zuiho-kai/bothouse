'use strict';
const crypto = require('node:crypto');
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'SessionEnd'];
const text = (v, n = 180) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, n) : '';
function canonical(value, depth = 0) {
  if (depth > 64) throw Error('Tool input nesting exceeds observer limit');
  if (Array.isArray(value)) return `[${value.map(v => canonical(v, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k], depth + 1)}`).join(',')}}`;
  return JSON.stringify(value);
}
function toolKey(raw, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !text(raw.tool_name) || !raw.tool_input || typeof raw.tool_input !== 'object') return '';
  try {
    // PermissionRequest omits tool_use_id. Correlate its input with Pre/Post
    // without retaining input or exposing a dictionary-attackable plain hash.
    return crypto.createHmac('sha256', key).update(canonical([text(raw.session_id), text(raw.agent_id), text(raw.tool_name), raw.tool_input])).digest('hex');
  } catch { return ''; }
}
function normalize(raw, options = {}) {
  if (!raw || !EVENTS.includes(raw.hook_event_name) || !text(raw.session_id)) return null;
  if (['SubagentStart', 'SubagentStop'].includes(raw.hook_event_name) && !text(raw.agent_id)) return null;
  const cwd = text(raw.cwd, 2048);
  return {
    id: crypto.randomUUID(), at: options.now ?? Date.now(), event: raw.hook_event_name,
    session: text(raw.session_id), agent: text(raw.agent_id), agentType: text(raw.agent_type, 80),
    project: text(cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop()) || 'Untitled workspace',
    tool: text(raw.tool_name, 80), toolId: text(raw.tool_use_id), toolKey: toolKey(raw, options.observerKey), notification: text(raw.notification_type, 80),
    interrupted: raw.is_interrupt === true, background: Array.isArray(raw.background_tasks) && raw.background_tasks.length > 0,
    scheduled: Array.isArray(raw.session_crons) && raw.session_crons.length > 0,
    // Explicit opt-in only. No prompt, tool input, transcript path, or error text is stored.
    result: options.captureResults ? text(raw.last_assistant_message, 16000) : '',
  };
}
function validEvent(e) {
  return !!e && EVENTS.includes(e.event) && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 180 &&
    typeof e.session === 'string' && e.session.length > 0 && e.session.length <= 180 &&
    Number.isSafeInteger(e.at) && e.at > 0 && ['agent','agentType','project','tool','toolId','notification','result'].every(k => typeof e[k] === 'string' && e[k].length <= (k === 'result' ? 16000 : 180)) &&
    (!['SubagentStart','SubagentStop'].includes(e.event) || e.agent.length > 0) &&
    (e.toolKey === undefined || e.toolKey === '' || typeof e.toolKey === 'string' && /^[a-f0-9]{64}$/.test(e.toolKey)) &&
    ['interrupted','background','scheduled'].every(k => typeof e[k] === 'boolean');
}
module.exports = { EVENTS, normalize, validEvent };
