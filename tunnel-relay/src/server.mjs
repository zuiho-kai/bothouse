// bothouse tunnel relay (#2314 phase 1): host enrolment + opaque forwarding.
//
// Structure adapted from Kooyu services/relay/src/server.mjs
// (https://github.com/sh2001sh/Kooyu, commit e33137b, MIT License,
// Copyright (c) Kooyu contributors). Account gateway, mailbox, push and
// preview parts were dropped: this relay has no accounts and only forwards
// ciphertext between two bothouse machines.
//
// The relay never parses request or response bodies. It knows hostIds, IPs,
// timings and byte counts, nothing else.
//
// Every default number below is 沿用 (carried over) from Kooyu server.mjs@e33137b,
// as #2314 SPEC says "默认数值参考 Kooyu"; the source line is noted next to it.
// All are overridable via env in main.mjs.
import { createServer } from "node:http";
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const ID = "[a-f0-9]{64}";
const CHALLENGE_PREFIX = "bothouse-tunnel-relay-v1:";

export function createRelay({
  maxHosts = 1000, // 沿用 Kooyu server.mjs#L40
  maxPending = 2048, // 沿用 Kooyu server.mjs#L41
  maxPerHost = 128, // 沿用 Kooyu server.mjs#L248
  maxBody = 1024 * 1024, // 沿用 Kooyu server.mjs#L10 MAX_BODY
  authTimeoutMs = 10000, // SPEC #2314 1.2「超过 10 秒没认证就断」，沿用 Kooyu server.mjs#L437
  heartbeatMs = 20000, // 沿用 Kooyu server.mjs#L452
  requestTimeoutMs = 120000, // 沿用 Kooyu server.mjs#L154
  httpPerMinute = 600, // 沿用 Kooyu server.mjs#L194
  upgradesPerMinute = 30, // 沿用 Kooyu server.mjs#L425
  admissionCode = "",
  trustProxy = false,
  log = () => {},
} = {}) {
  const maxBuffer = 4 * maxBody; // 沿用 Kooyu server.mjs#L11 MAX_BUFFER
  const hosts = new Map(),
    pending = new Map(),
    rates = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * maxBody, perMessageDeflate: false }); // 沿用 Kooyu server.mjs#L67
  let closing = false;

  const json = (res, status, body) => {
    if (res.destroyed) return;
    if (res.headersSent) return void res.destroy();
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code) => json(res, status, { error: code });
  const send = (ws, value) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (value.type !== "cancel" && ws.bufferedAmount > maxBuffer) return false;
    ws.send(JSON.stringify(value));
    return true;
  };
  const clientIp = (req) =>
    trustProxy
      ? String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress).split(",").at(-1).trim()
      : req.socket.remoteAddress;
  const limited = (req, kind, limit) => {
    const key = kind + ":" + clientIp(req),
      now = Date.now();
    let entry = rates.get(key);
    if (!entry || now >= entry.until) {
      if (rates.size >= 20000 && !entry) return true; // 沿用 Kooyu server.mjs#L131
      rates.set(key, (entry = { count: 0, until: now + 60000 })); // 沿用 Kooyu server.mjs#L132（一分钟窗口）
    }
    return ++entry.count > limit;
  };
  const release = (id, cancel = false) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p.host.requests.delete(id);
    clearTimeout(p.timer);
    if (cancel) send(p.host.ws, { type: "cancel", id });
  };
  const touch = (id) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      release(id, true);
      fail(p.res, 504, "RELAY_TIMEOUT");
    }, requestTimeoutMs);
    p.timer.unref();
  };

  const server = createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("cache-control", "no-store");
    try {
      if (closing) return fail(res, 503, "RELAY_RESTARTING");
      const url = new URL(req.url, "http://relay.invalid");
      if (url.pathname === "/healthz" && req.method === "GET")
        return json(res, 200, { service: "bothouse-tunnel-relay", status: "ok", version: 1, hosts: hosts.size });
      if (limited(req, "http", httpPerMinute)) return fail(res, 429, "RATE_LIMITED");

      const key = new RegExp("^/h/(" + ID + ")/key$").exec(url.pathname);
      if (key && req.method === "GET") {
        const host = hosts.get(key[1]);
        if (!host) return fail(res, 503, "HOST_OFFLINE");
        return json(res, 200, { hostId: host.id, publicKey: host.publicKey, ...host.extra });
      }

      const tunnel = new RegExp("^/h/(" + ID + ")/t$").exec(url.pathname);
      if (!tunnel) return fail(res, 404, "NOT_FOUND");
      if (req.method !== "POST") return fail(res, 405, "INVALID_METHOD");
      const host = hosts.get(tunnel[1]);
      if (!host) return fail(res, 503, "HOST_OFFLINE");
      if (host.requests.size >= maxPerHost || pending.size >= maxPending) return fail(res, 429, "RELAY_BUSY");
      if (Number(req.headers["content-length"] ?? 0) > maxBody) return fail(res, 413, "TOO_LARGE");
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBody) return fail(res, 413, "TOO_LARGE");
        chunks.push(chunk);
      }
      if (hosts.get(tunnel[1]) !== host) return fail(res, 503, "HOST_OFFLINE");
      if (host.requests.size >= maxPerHost || pending.size >= maxPending) return fail(res, 429, "RELAY_BUSY");
      const id = randomUUID();
      pending.set(id, { host, res, timer: undefined, started: false });
      host.requests.add(id);
      touch(id);
      res.on("close", () => release(id, true));
      if (!send(host.ws, { type: "request", id, body: Buffer.concat(chunks).toString("base64") })) {
        release(id);
        const open = host.ws.readyState === WebSocket.OPEN;
        return fail(res, open ? 429 : 503, open ? "RELAY_BUSY" : "HOST_OFFLINE");
      }
      log("forward", { hostId: host.id, bytes: size });
    } catch {
      fail(res, 400, "INVALID_REQUEST");
    }
  });
  server.headersTimeout = 15000; // 沿用 Kooyu server.mjs#L381
  server.requestTimeout = 30000; // 沿用 Kooyu server.mjs#L382

  server.on("upgrade", (req, socket, head) => {
    if (
      closing ||
      req.url !== "/v1/host" ||
      req.headers.origin ||
      wss.clients.size >= maxHosts + 32 || // 沿用 Kooyu server.mjs#L424
      limited(req, "upgrade", upgradesPerMinute)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const challenge = CHALLENGE_PREFIX + randomBytes(32).toString("base64url"); // 沿用 Kooyu server.mjs#L433
      let host,
        alive = true;
      const timer = setTimeout(() => ws.close(1008, "Authentication timeout"), authTimeoutMs);
      timer.unref();
      ws.on("error", () => {});
      ws.on("pong", () => (alive = true));
      const heartbeat = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, heartbeatMs);
      heartbeat.unref();
      send(ws, { type: "challenge", challenge, version: 1 });
      ws.on("message", (raw, binary) => {
        try {
          if (binary) throw new Error("binary frames not supported in v1");
          const m = JSON.parse(raw.toString());
          if (!host) {
            if (
              m.type !== "authenticate" ||
              typeof m.publicKey !== "string" ||
              m.publicKey.length > 256 || // 沿用 Kooyu server.mjs#L477
              typeof m.signature !== "string" ||
              m.signature.length > 128 // 沿用 Kooyu server.mjs#L479
            )
              throw new Error("Invalid identity");
            if (admissionCode && m.admission !== admissionCode) return ws.close(4403, "Admission code required");
            const der = Buffer.from(m.publicKey, "base64"),
              pub = createPublicKey({ key: der, format: "der", type: "spki" });
            if (pub.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(challenge), pub, Buffer.from(m.signature, "base64")))
              throw new Error("Invalid signature");
            const id = createHash("sha256").update(der).digest("hex");
            if (hosts.has(id) || hosts.size >= maxHosts) return ws.close(1013, "Already connected or capacity reached");
            // Optional host-signed encryption key, passed through untouched for GET /h/<id>/key.
            // 长度上限沿用上面 publicKey / signature 的上限。
            const extra = {};
            if (typeof m.encKey === "string" && m.encKey.length <= 256) extra.encKey = m.encKey;
            if (typeof m.encKeySig === "string" && m.encKeySig.length <= 128) extra.encKeySig = m.encKeySig;
            clearTimeout(timer);
            host = { id, ws, publicKey: m.publicKey, extra, requests: new Set() };
            hosts.set(id, host);
            send(ws, { type: "ready", hostId: id });
            log("host-ready", { hostId: id });
            return;
          }
          const p = pending.get(m.id);
          if (!p || p.host !== host) return;
          touch(m.id);
          if (m.type === "head") {
            // HTTP 状态码范围，沿用 Kooyu server.mjs#L555-L557
            if (p.started || !Number.isInteger(m.status) || m.status < 200 || m.status > 599) throw new Error("Invalid head");
            p.started = true;
            p.res.setHeader("content-type", "application/octet-stream");
            p.res.setHeader("x-accel-buffering", "no");
            p.res.writeHead(m.status);
            p.res.flushHeaders();
          } else if (m.type === "chunk") {
            // 单块上限沿用 WebSocket maxPayload（2 * maxBody）
            if (!p.started || typeof m.data !== "string" || m.data.length > 2 * maxBody) throw new Error("Invalid chunk");
            if (p.res.writableLength > maxBody) { // 沿用 Kooyu server.mjs#L592
              release(m.id, true);
              return void p.res.destroy();
            }
            p.res.write(Buffer.from(m.data, "base64"));
          } else if (m.type === "end") {
            release(m.id);
            p.res.end();
          } else if (m.type === "error") {
            release(m.id);
            fail(p.res, 502, "HOST_REQUEST_FAILED");
          } else throw new Error("Invalid frame");
        } catch {
          ws.close(1008, "Invalid protocol");
        }
      });
      ws.on("close", () => {
        clearTimeout(timer);
        clearInterval(heartbeat);
        if (host && hosts.get(host.id) === host) hosts.delete(host.id);
        if (host) {
          for (const id of [...host.requests]) {
            const p = pending.get(id);
            release(id);
            if (p) fail(p.res, 503, "HOST_OFFLINE");
          }
          log("host-gone", { hostId: host.id });
        }
      });
    });
  });

  // 每分钟清一次限流表，沿用 Kooyu server.mjs#L622-L627
  const prune = setInterval(() => {
    for (const [k, v] of rates) if (v.until <= Date.now()) rates.delete(k);
  }, 60000);
  prune.unref();

  return {
    server,
    hosts,
    async close() {
      closing = true;
      clearInterval(prune);
      for (const ws of wss.clients) ws.terminate();
      for (const id of [...pending.keys()]) {
        const p = pending.get(id);
        release(id);
        p.res.destroy();
      }
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      wss.close();
    },
  };
}
