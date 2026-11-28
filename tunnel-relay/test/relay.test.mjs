import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import WebSocket from "ws";
import { createRelay } from "../src/server.mjs";
import { connectHost, newIdentity } from "../src/host.mjs";

async function start(opts) {
  const relay = createRelay(opts);
  await new Promise((r) => relay.server.listen(0, "127.0.0.1", r));
  return { relay, url: `http://127.0.0.1:${relay.server.address().port}` };
}

test("healthz, enrol, key, forward round trip", async () => {
  const { relay, url } = await start();
  assert.equal((await fetch(url + "/healthz")).status, 200);
  const id = newIdentity();
  const host = connectHost(url, { identity: id, handle: (b) => `${b}!` });
  const hostId = await host.ready;
  assert.equal(hostId, createHash("sha256").update(Buffer.from(id.publicKey, "base64")).digest("hex"));
  const key = await (await fetch(`${url}/h/${hostId}/key`)).json();
  assert.equal(key.publicKey, id.publicKey);
  const res = await fetch(`${url}/h/${hostId}/t`, { method: "POST", body: "hi" });
  assert.equal(await res.text(), "hi!");
  host.close();
  await relay.close();
});

test("wrong signature is rejected", async () => {
  const { relay, url } = await start();
  const other = generateKeyPairSync("ed25519");
  const id = { ...newIdentity(), privateKey: other.privateKey };
  await assert.rejects(connectHost(url, { identity: id, handle: () => "" }).ready);
  await relay.close();
});

test("admission code required when configured", async () => {
  const { relay, url } = await start({ admissionCode: "s3cret" });
  await assert.rejects(connectHost(url, { handle: () => "" }).ready);
  const ok = connectHost(url, { admission: "s3cret", handle: () => "" });
  await ok.ready;
  ok.close();
  await relay.close();
});

test("unauthenticated host is dropped after timeout; Origin header refused", async () => {
  const { relay, url } = await start({ authTimeoutMs: 100 });
  const ws = new WebSocket(url.replace("http", "ws") + "/v1/host");
  const code = await new Promise((r) => ws.on("close", (c) => r(c)));
  assert.equal(code, 1008);
  const bad = new WebSocket(url.replace("http", "ws") + "/v1/host", { headers: { origin: "https://evil.example" } });
  await new Promise((r) => bad.on("error", r));
  await relay.close();
});

test("streams chunks progressively, offline 503, oversize 413", async () => {
  const { relay, url } = await start({ maxBody: 1000 });
  const host = connectHost(url, {
    handle: async function* () {
      for (let i = 0; i < 5; i++) {
        yield `c${i};`;
        await new Promise((r) => setTimeout(r, 30));
      }
    },
  });
  const hostId = await host.ready;
  const res = await fetch(`${url}/h/${hostId}/t`, { method: "POST", body: "x" });
  const reader = res.body.getReader();
  const arrivals = [];
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    arrivals.push(Date.now());
    text += Buffer.from(value).toString();
  }
  assert.equal(text, "c0;c1;c2;c3;c4;");
  assert.ok(arrivals.length > 1, "chunks arrive progressively, not all at once");
  assert.equal((await fetch(`${url}/h/${"0".repeat(64)}/t`, { method: "POST", body: "x" })).status, 503);
  assert.equal((await fetch(`${url}/h/${hostId}/t`, { method: "POST", body: "y".repeat(2000) })).status, 413);
  host.close();
  await relay.close();
});

test("relay log never contains request body", async () => {
  const lines = [];
  const { relay, url } = await start({ log: (e, f) => lines.push(JSON.stringify({ e, ...f })) });
  const host = connectHost(url, { handle: () => "ok" });
  const hostId = await host.ready;
  await (await fetch(`${url}/h/${hostId}/t`, { method: "POST", body: "TOPSECRET-BODY" })).text();
  assert.ok(lines.length > 0);
  assert.ok(!lines.join("\n").includes("TOPSECRET-BODY"));
  host.close();
  await relay.close();
});
