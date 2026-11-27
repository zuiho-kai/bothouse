// Minimal host-side client: connect to /v1/host, prove key ownership, then
// hand every forwarded request body to `handle(body) -> AsyncIterable<Buffer>|Buffer`.
// Used by the demo and tests; DSH integration (#2314 phase 2) builds on this.
import { generateKeyPairSync, sign } from "node:crypto";
import WebSocket from "ws";

export function newIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"), privateKey };
}

export function connectHost(relayUrl, { identity = newIdentity(), handle, admission, onEvent = () => {} } = {}) {
  const ws = new WebSocket(new URL("/v1/host", relayUrl.replace(/^http/, "ws")));
  const ready = new Promise((resolve, reject) => {
    ws.once("error", reject);
    ws.once("close", (code, reason) => reject(new Error(`closed ${code} ${reason}`)));
    ws.on("message", async (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "challenge") {
        onEvent("challenge", m.challenge);
        const signature = sign(null, Buffer.from(m.challenge), identity.privateKey).toString("base64");
        ws.send(JSON.stringify({ type: "authenticate", publicKey: identity.publicKey, signature, admission }));
        onEvent("signed");
      } else if (m.type === "ready") {
        onEvent("ready", m.hostId);
        resolve(m.hostId);
      } else if (m.type === "request") {
        onEvent("request", m.id);
        try {
          const out = await handle(Buffer.from(m.body, "base64"));
          ws.send(JSON.stringify({ type: "head", id: m.id, status: 200 }));
          const parts = Buffer.isBuffer(out) || typeof out === "string" ? [out] : out;
          for await (const part of parts) ws.send(JSON.stringify({ type: "chunk", id: m.id, data: Buffer.from(part).toString("base64") }));
          ws.send(JSON.stringify({ type: "end", id: m.id }));
        } catch {
          ws.send(JSON.stringify({ type: "error", id: m.id }));
        }
      } else if (m.type === "cancel") onEvent("cancel", m.id);
    });
  });
  return { ws, ready, close: () => ws.close() };
}
