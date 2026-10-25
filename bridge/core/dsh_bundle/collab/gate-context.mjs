// Per-turn wiki pages and task board for DSH-native members, from the local gate's
// POST /context (bridge/contrib/gate/gate.py -> ctxsvc.context): the same source and the same
// block the bridge puts before a bot's turn (bridge/core/gate.go turnContext). The gate's port
// comes from GATE_PORT, which bothouse sets on the `dsh web` it starts to the port it runs the
// gate on (core/gate_proc.go gatePort); without it, or with the gate down, a turn goes out as before.

// Same as the bridge's wait for /context (core/gate.go turnContext: 2s).
export const GATE_CONTEXT_TIMEOUT_MS = 2_000;

export class GateContext {
  /**
   * @param options - { port?: gate port (default process.env.GATE_PORT), timeoutMs?, fetch?, logger? }.
   */
  constructor({ port = process.env.GATE_PORT, timeoutMs = GATE_CONTEXT_TIMEOUT_MS, fetch: fetchFn = globalThis.fetch, logger } = {}) {
    this.port = String(port ?? '').trim();
    this.timeoutMs = timeoutMs;
    this.fetch = fetchFn;
    this.logger = logger;
    /** `${member}\0${room}` -> { session, paths: Set } : pages already in that conversation's context. */
    this.sent = new Map();
  }

  /**
   * The block of pages this (member, room) conversation has not been given yet, and a commit()
   * that records them as given (call it once the prompt is handed to the agent). The bridge keeps
   * one list per session (core/gate.go UpdateTurnCtx); here a new `session` starts the list over.
   * @returns {Promise<{ block: string, commit: () => void }>} block is '' when there is nothing new.
   */
  async turn({ member, room, session, text }) {
    const none = { block: '', commit: () => {} };
    if (!this.port || typeof this.fetch !== 'function') return none;
    let out;
    try {
      const res = await this.fetch(`http://127.0.0.1:${this.port}/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // bot = the member id: the gate's team file names DSH members by it (lead.identity).
        body: JSON.stringify({ key: `dsh:${member}:${room}`, text: text ?? '', bot: String(member) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      out = await res.json();
    } catch (error) {
      this.logger?.debug?.('collab: gate context fetch failed: %s', error?.message ?? error);
      return none;
    }
    const key = `${member}\u0000${room}`;
    let entry = this.sent.get(key);
    if (entry !== undefined && entry.session !== session) entry = undefined;
    const known = entry?.paths ?? new Set();
    const fresh = (Array.isArray(out?.wiki) ? out.wiki : [])
      .filter(w => w && typeof w.path === 'string' && !known.has(w.path));
    if (fresh.length === 0) return none;
    const block = '（可能相关的 wiki 页，需要时去读）' + fresh.map(w => `\n- ${w.path} — ${w.desc ?? ''}`).join('');
    return {
      block,
      commit: () => {
        let cur = this.sent.get(key);
        if (cur === undefined || cur.session !== session) { cur = { session, paths: new Set() }; this.sent.set(key, cur); }
        for (const w of fresh) cur.paths.add(w.path);
      },
    };
  }

  /** A released workspace starts its conversations over: give every page again. */
  resetRoom(room) {
    for (const key of this.sent.keys()) if (key.endsWith(`\u0000${room}`)) this.sent.delete(key);
  }
}
