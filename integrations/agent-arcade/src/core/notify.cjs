'use strict';
// Notify for the settled state of each inbox batch. A brief permission wait
// resolved before this poll must not produce a now-misleading attention alert.
function coalesceChanges(changes) {
  const latest = new Map();
  for (const change of changes) {
    const first = latest.get(change.task.id);
    const previous = first ? first.previous : change.previous;
    const previousReason = first ? first.previousReason : change.previousReason;
    latest.set(change.task.id, { ...change, previous, previousReason,
      changed: previous !== change.task.state || previousReason !== change.task.reason });
  }
  return [...latest.values()];
}
class NotificationGate {
  constructor() { this.sent = new Map(); }
  allow(change, { enabled = false, quiet = false, focused = false } = {}, now = Date.now()) {
    if (!change?.changed || !enabled || quiet || focused || !['waiting','error','done'].includes(change.task.state) || now - change.task.updatedAt > 30000) return false;
    const key = change.task.id;
    if (now - (this.sent.get(key) ?? -Infinity) < 15000) return false;
    this.sent.set(key, now);
    if (this.sent.size > 200) this.sent.delete(this.sent.keys().next().value);
    return true;
  }
}
module.exports = { NotificationGate, coalesceChanges };
