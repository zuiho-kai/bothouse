// Talk to the bothouse bridge from a DSH plugin: role events (SSE) and per-role bindings.
//
// Contract: docs/plugins/role-events.md. Every plugin made from the template carries its own copy
// of this file (a plugin is a standalone npm package), so keep it dependency-free.
//
//   const roles = followRoles({ bridge, token, pluginId, logger, onEvent })
//   ctx.effect(() => () => roles.stop())
//
// onEvent(event, role) is called only for roles whose binding lists this plugin with enabled: true
// (GET /api/v1/plugins/role-bindings). Roles nobody bound are skipped: there is no default.

export const STATUSES = ['idle', 'working', 'thinking', 'celebrate', 'error', 'speech'];

// 来源：沿用 docs/plugins/role-events.md「断开后按现有 DSH 三秒读取超时重试并重取状态」。
const RETRY_MS = 3000;
// 来源：沿用 docs/plugins/role-events.md「忙闲另沿用 DSH presence 的两秒刷新周期」；绑定在面板里改了，这么久内生效。
const BINDINGS_TTL_MS = 2000;

/** Normalise the bridge address from config: no trailing slash. */
export function bridgeBase(bridge) {
  // 来源：沿用 bridge/config.example.toml [management] port 默认值。
  const base = String(bridge || 'http://127.0.0.1:9820').trim();
  return base.replace(/\/+$/, '');
}

function headers(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** GET /api/v1/plugins/role-bindings → { [role_key]: [{plugin_id, enabled, avatar_pack?}] }. */
export async function fetchBindings({ bridge, token, fetchImpl = fetch }) {
  const res = await fetchImpl(`${bridgeBase(bridge)}/api/v1/plugins/role-bindings`, { headers: headers(token) });
  if (!res.ok) throw new Error(`role-bindings: HTTP ${res.status}`);
  const body = await res.json();
  if (body && body.ok === false) throw new Error(`role-bindings: ${body.error || 'refused'}`);
  return body?.data?.bindings ?? {};
}

/** Role keys whose binding enables pluginId. */
export function enabledRoles(bindings, pluginId) {
  const out = new Set();
  for (const [roleKey, list] of Object.entries(bindings || {})) {
    if (Array.isArray(list) && list.some((b) => b && b.plugin_id === pluginId && b.enabled)) out.add(roleKey);
  }
  return out;
}

/**
 * Parse an SSE byte stream into {event, data} frames. data is JSON-decoded; a frame that does not
 * decode is skipped. Exported for tests.
 */
export async function* readSSE(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let event = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try {
        yield { event, data: JSON.parse(data.join('\n')) };
      } catch {
        // not JSON: not one of ours
      }
    }
  }
}

/**
 * Follow GET /api/v1/roles/events until stop(). Calls onSnapshot(roles) on every (re)connect with
 * the bound roles, and onEvent(event, role) for each status/speech frame of a bound role.
 */
export function followRoles({ bridge, token, pluginId, logger = console, onEvent, onSnapshot, fetchImpl = fetch }) {
  let stopped = false;
  let controller;
  let bound = new Set();
  let boundAt = 0;

  async function refreshBindings(force) {
    if (!force && Date.now() - boundAt < BINDINGS_TTL_MS) return;
    boundAt = Date.now();
    try {
      bound = enabledRoles(await fetchBindings({ bridge, token, fetchImpl }), pluginId);
    } catch (err) {
      logger.warn(`${pluginId}: cannot read role bindings: ${err.message}`);
    }
  }

  async function once() {
    controller = new AbortController();
    const res = await fetchImpl(`${bridgeBase(bridge)}/api/v1/roles/events`, {
      headers: { ...headers(token), Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`roles/events: HTTP ${res.status}`);
    for await (const frame of readSSE(res.body)) {
      if (stopped) return;
      if (frame.event === 'snapshot') {
        await refreshBindings(true);
        const roles = (frame.data.roles || []).filter((r) => bound.has(r.role_key));
        await onSnapshot?.(roles, frame.data);
        continue;
      }
      if (!STATUSES.includes(frame.event)) continue;
      await refreshBindings(false);
      const ev = frame.data;
      if (!bound.has(ev.role_key)) continue;
      try {
        await onEvent?.(ev, ev.role);
      } catch (err) {
        logger.warn(`${pluginId}: handler failed: ${err.message}`);
      }
    }
    throw new Error('stream ended');
  }

  (async () => {
    while (!stopped) {
      try {
        await once();
      } catch (err) {
        if (stopped) break;
        logger.warn(`${pluginId}: role events: ${err.message}; retry in ${RETRY_MS / 1000}s`);
      }
      if (!stopped) await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  })();

  return {
    stop() {
      stopped = true;
      controller?.abort();
    },
  };
}

/** What to call the role in a message: display name, then name, then the key. */
export function roleLabel(ev) {
  const r = ev.role || {};
  return r.display_name || r.name || ev.role_key;
}

/** statuses from config: a list of names; empty or missing = every status. */
export function statusFilter(list) {
  const want = Array.isArray(list) ? list.filter((s) => STATUSES.includes(s)) : [];
  return want.length ? new Set(want) : new Set(STATUSES);
}
