// One-command demo (#2314 item 1.6): fake host + fake client through a relay.
//   node scripts/demo.mjs                      -> starts a local relay on 127.0.0.1
//   node scripts/demo.mjs https://relay.example -> uses a deployed relay
// Prints each step and "OK", exits 0 on success.
import { createRelay } from "../src/server.mjs";
import { connectHost } from "../src/host.mjs";

const step = (...a) => console.log("[demo]", ...a);
let relayUrl = process.argv[2],
  local;
if (!relayUrl) {
  local = createRelay();
  await new Promise((r) => local.server.listen(0, "127.0.0.1", r));
  relayUrl = `http://127.0.0.1:${local.server.address().port}`;
  step("local relay on", relayUrl);
} else step("using relay", relayUrl);

const health = await (await fetch(new URL("/healthz", relayUrl))).json();
step("healthz", JSON.stringify(health));
const host = connectHost(relayUrl, {
  admission: process.env.RELAY_ADMISSION_CODE,
  onEvent: (e, v) => step("host:", e, v ? String(v).slice(0, 48) : ""),
  handle: (body) => `${body} from host`,
});
const hostId = await host.ready;
const key = await (await fetch(new URL(`/h/${hostId}/key`, relayUrl))).json();
step("client: fetched host key, fingerprint matches =", key.hostId === hostId);
step("client: POST hello");
const res = await fetch(new URL(`/h/${hostId}/t`, relayUrl), { method: "POST", body: "hello" });
const text = await res.text();
step("client: got", res.status, JSON.stringify(text));
host.close();
await local?.close();
if (res.status === 200 && text === "hello from host") {
  console.log("OK");
  process.exit(0);
}
console.log("FAIL");
process.exit(1);
