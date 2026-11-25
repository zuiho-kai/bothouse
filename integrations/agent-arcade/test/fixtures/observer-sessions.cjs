'use strict';
const { Store } = require('../../src/core/store.cjs');
const { normalize } = require('../../src/core/events.cjs');
function demoStore() {
  const s = new Store(); const now = Date.now();
  const emit = (id, event, extra, ago) => s.apply(normalize({ session_id: id, hook_event_name: event, ...extra }, { now: now - ago, captureResults: true }));
  emit('demo-api', 'PreToolUse', { cwd: '/demo/orbit-api', tool_name: 'Edit' }, 8000);
  emit('demo-ui', 'PermissionRequest', { cwd: '/demo/field-notes', tool_name: 'Bash' }, 24000);
  emit('demo-tests', 'PostToolUseFailure', { cwd: '/demo/checkout', tool_name: 'Bash' }, 45000);
  emit('demo-docs', 'Stop', { cwd: '/demo/agent-arcade', last_assistant_message: 'Documentation is ready.\n\n• Added the quick start and hook setup guide.\n• Explained state accuracy and privacy defaults.\n• Added a theme template for the community.\n\nThis is a demonstration result, not output from a live agent.' }, 75000);
  return s;
}
module.exports = { demoStore };
