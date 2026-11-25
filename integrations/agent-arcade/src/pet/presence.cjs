'use strict';
// One character, several bodies. The presence is the single description of
// what the companion is doing right now. Each body (the desktop window, a desk
// robot) renders it in its own way and may report a touch back, which the
// other bodies then feel too. Nothing here knows about windows, serial ports
// or the chat: main.cjs feeds it, and bodies attach to it.
//
// A body is any object with some of: present({activity, attention}), pulse(),
// react(kind). A body that throws is reported and skipped; it cannot stop the
// others from being told.
const ACTIVITIES = Object.freeze(['idle', 'thinking', 'speaking', 'failed', 'unknown']);
// Touches the other bodies answer with the same reaction. Being lifted and put
// down belongs to the body it happened to and is not echoed.
const SHARED_REACTIONS = Object.freeze(['poke', 'huff', 'pat']);
const TOUCHES = Object.freeze([...SHARED_REACTIONS, 'held', 'released']);
const MAX_BODIES = 8;

class PetPresence {
  constructor({onError = () => {}} = {}) {
    this.activity = 'idle'; this.attention = false; this.bodies = new Map(); this.onError = onError;
  }
  snapshot() { return {activity: this.activity, attention: this.attention}; }
  attach(id, body) {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(id)) throw TypeError('Invalid body id');
    if (!body || typeof body !== 'object') throw TypeError('Invalid body');
    if (!this.bodies.has(id) && this.bodies.size >= MAX_BODIES) throw Error('Too many bodies');
    this.bodies.set(id, body);
    this.tell(id, body, 'present', this.snapshot());
    return () => { if (this.bodies.get(id) === body) this.bodies.delete(id); };
  }
  tell(id, body, method, value) {
    if (typeof body[method] !== 'function') return;
    try { body[method](value); } catch (error) { try { this.onError(error, id, method); } catch { /* reporting must not break the others */ } }
  }
  each(method, value, except) { for (const [id, body] of [...this.bodies]) if (id !== except) this.tell(id, body, method, value); }

  // Clearing the conversation also clears its unread cue, in one update.
  reset() {
    if (this.activity === 'idle' && !this.attention) return;
    this.activity = 'idle'; this.attention = false;
    this.each('present', this.snapshot());
  }
  // Unknown is an explicit observation. Keep the idle default for unsupported inputs.
  setActivity(state) {
    const next = ACTIVITIES.includes(state) ? state : 'idle';
    if (next === this.activity) return false;
    this.activity = next; this.each('present', this.snapshot());
    return true;
  }
  // A piece of a reply arrived.
  pulse() { this.each('pulse'); }
  // Something is waiting for the user in the app, until they open it.
  raiseAttention() { if (this.attention) return false; this.attention = true; this.each('present', this.snapshot()); return true; }
  clearAttention() { if (!this.attention) return false; this.attention = false; this.each('present', this.snapshot()); return true; }

  // A body reports that the user touched it. Returns whether it was passed on.
  touched(from, kind) {
    if (!this.bodies.has(from) || !TOUCHES.includes(kind)) return false;
    if (!SHARED_REACTIONS.includes(kind)) return false;
    this.each('react', kind, from);
    return true;
  }
}

module.exports = {PetPresence, ACTIVITIES, SHARED_REACTIONS, TOUCHES, MAX_BODIES};
