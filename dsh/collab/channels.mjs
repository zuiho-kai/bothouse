// #2314 item 2.1: transport channel abstraction for cross-machine pairing and proxying.
//
// Each channel provides:
//   - name: string ('tailscale' | 'tunnel' | custom test channel)
//   - controller side:
//       requestJSON(target, { path, method, body, headers, timeout }) -> Promise<{ status, body, headers? }>
//       proxyStream(target, { method, path, headers, req, signal }) -> Promise<{ status, headers, stream, abort }>
//       formatProxyError?(err) -> { status, error, code }
//   - host side:
//       start?() -> Promise<any>
//       stop?() -> Promise<void>
//       status?() -> object
import { request as httpRequest } from 'node:http';

/** Small JSON request over plain HTTP (Tailscale tailnet or loopback). */
export function httpRequestJSON({ host, port, path, method = 'GET', body, headers = {}, timeout = 4000 }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({
      host,
      port,
      path,
      method,
      timeout,
      headers: {
        accept: 'application/json',
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { value = undefined; }
        resolve({ status: res.statusCode ?? 0, body: value, headers: res.headers });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * Default Tailscale direct HTTP channel: preserves every existing behavior, timeout, and error
 * message of pairing.mjs before #2314.
 */
export function createTailscaleChannel({
  requestJSON = httpRequestJSON,
  requestStream = httpRequest,
  listener,
  defaultPort,
} = {}) {
  return {
    name: 'tailscale',
    requestJSON(target, opts) {
      return requestJSON({
        host: target.host,
        port: target.port ?? defaultPort,
        ...opts,
      });
    },
    proxyStream(target, { method, path, headers, req }) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const up = requestStream({
          host: target.host,
          port: target.port ?? defaultPort,
          method,
          path,
          headers,
        }, upRes => {
          settled = true;
          resolve({
            status: upRes.statusCode ?? 502,
            headers: upRes.headers,
            stream: upRes,
            abort: () => { up.destroy(); upRes.destroy(); },
          });
        });
        up.on('error', err => {
          if (!settled) { settled = true; reject(err); }
        });
        req.pipe(up);
      });
    },
    formatProxyError() {
      return {
        status: 502,
        code: 'unreachable',
        error: '连不上那台电脑：它可能关机、DSH 没开、Tailscale 断了，或已经把这台踢掉',
      };
    },
    async start() {
      return listener?.ensure?.();
    },
    async stop() {
      return listener?.close?.();
    },
    status() {
      return {
        channel: 'tailscale',
        state: listener?.server ? 'listening' : 'idle',
        listening: listener?.bound ?? null,
      };
    },
  };
}

/** Registry mapping channel names ('tailscale', 'tunnel', ...) to channel implementations. */
export class ChannelRegistry {
  constructor(initial = []) {
    this.map = new Map();
    for (const ch of initial) this.register(ch);
  }

  register(channel) {
    if (!channel || typeof channel.name !== 'string' || !channel.name) {
      throw new Error('channel must have a non-empty name');
    }
    this.map.set(channel.name, channel);
    return this;
  }

  get(name = 'tailscale') {
    return this.map.get(name || 'tailscale');
  }

  has(name) {
    return this.map.has(name);
  }

  list() {
    return [...this.map.values()];
  }

  statuses() {
    return Object.fromEntries(
      this.list()
        .filter(c => typeof c.status === 'function')
        .map(c => [c.name, c.status()]),
    );
  }
}
