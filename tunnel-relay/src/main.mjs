// Start the relay from environment variables. Put it behind an HTTPS reverse
// proxy (Caddy, nginx, Cloudflare Tunnel); it speaks plain HTTP/WS itself.
import { createRelay } from "./server.mjs";

const num = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);
const relay = createRelay({
  maxHosts: num("RELAY_MAX_HOSTS", undefined),
  maxBody: num("RELAY_MAX_BODY", undefined),
  admissionCode: process.env.RELAY_ADMISSION_CODE ?? "",
  trustProxy: process.env.RELAY_TRUST_PROXY === "1",
  log: (event, fields) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields })),
});
const port = num("PORT", 4321);
const bind = process.env.RELAY_BIND ?? "127.0.0.1";
relay.server.listen(port, bind, () => console.log(`bothouse tunnel relay listening on ${bind}:${port}`));
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void relay.close().then(() => (process.exitCode = 0));
  });
