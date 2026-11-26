'use strict';
// In-process listen/notify bus. Sources publish events; subscribers (desktop
// notifications, the renderer snapshot, the companion notifier) are told
// synchronously. Bounded and isolated: a duplicate id is dropped, one failing
// subscriber cannot stop the others, and nothing here performs I/O.
const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_SUBSCRIBERS = 64, MAX_SEEN = 2000, MAX_RECENT = 100, MAX_DEPTH = 4;

function matcher(filter) {
  if (filter === undefined || filter === null) return () => true;
  if (typeof filter === 'function') return filter;
  if (typeof filter !== 'object' || Array.isArray(filter)) throw TypeError('Invalid bus filter');
  const {source, kind} = filter;
  for (const value of [source, kind]) if (value !== undefined && (typeof value !== 'string' || !value)) throw TypeError('Invalid bus filter');
  // A kind ending in "." matches the whole family, e.g. "calendar." or "session.".
  const kindMatch = kind === undefined ? () => true : kind.endsWith('.') ? value => value.startsWith(kind) : value => value === kind;
  return event => (source === undefined || event.source === source) && kindMatch(event.kind);
}

class Bus {
  constructor({onError = () => {}} = {}) {
    this.subscribers = new Set(); this.seen = new Set(); this.kept = []; this.depth = 0; this.onError = onError;
  }
  subscribe(filter, handler) {
    if (typeof handler !== 'function') throw TypeError('Bus subscriber must be a function');
    if (this.subscribers.size >= MAX_SUBSCRIBERS) throw Error('Too many bus subscribers');
    const entry = {match:matcher(filter), handler};
    this.subscribers.add(entry);
    return () => { this.subscribers.delete(entry); };
  }
  // Returns true when the event was delivered, false for a duplicate id or a
  // publish nested too deeply inside subscribers.
  publish(event) {
    if (!event || typeof event !== 'object' || !NAME.test(event.source) || !NAME.test(event.kind)) throw TypeError('Invalid bus event');
    if (event.id !== undefined) {
      if (typeof event.id !== 'string' || !event.id || event.id.length > 128) throw TypeError('Invalid bus event');
      if (this.seen.has(event.id)) return false;
    }
    if (this.depth >= MAX_DEPTH) return false;
    if (event.id !== undefined) {
      this.seen.add(event.id);
      if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value);
    }
    const frozen = Object.isFrozen(event) ? event : Object.freeze({...event});
    // Only display-safe envelopes (those with a title) are kept for the UI.
    if (typeof frozen.title === 'string') {
      this.kept.push({id:frozen.id, at:frozen.at, source:frozen.source, kind:frozen.kind, subject:frozen.subject, title:frozen.title, importance:frozen.importance});
      if (this.kept.length > MAX_RECENT) this.kept.shift();
    }
    this.depth++;
    try {
      for (const entry of [...this.subscribers]) {
        try { if (entry.match(frozen)) entry.handler(frozen); } catch (error) { try { this.onError(error, frozen); } catch { /* reporting must not break delivery */ } }
      }
    } finally { this.depth--; }
    return true;
  }
  recent(limit = 30) { return this.kept.slice(-Math.max(0, Math.min(MAX_RECENT, limit))).reverse(); }
}
module.exports = {Bus, MAX_SUBSCRIBERS, MAX_SEEN, MAX_RECENT};
