window.__ModuleLoader__.load({
 id: "bothouse-dsh-devices",
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
"use strict";
const { jsx } = require("react/jsx-runtime");
const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
const NS = "bothouse-dsh-devices";
const DICT = {"zh":{"label":"其他电脑"},"en":{"label":"Other computers"}};
const BG = "var(--dsw-alias-bg-base)";
// Same frame as client-ui-discord EmbedPage: same-origin page, relative to document.baseURI so
// the panel proxy's /dsh/ prefix is kept. Same-origin Referer lets the proxy verify
// a port-less Origin; cross-origin destinations still receive no Referer.
function EmbedPage({ path, title }) {
  const src = new URL(path, document.baseURI).toString();
  return jsx("div", { style: { boxSizing: "border-box", display: "flex", width: "100%", height: "100%", minHeight: 0, paddingTop: "var(--dsh-frame-top-clearance, 0px)", background: BG },
    children: jsx("iframe", { src, title, loading: "lazy", referrerPolicy: "same-origin", style: { flex: 1, width: "100%", height: "100%", border: 0, background: BG } }) });
}
function Icon({ size }) { return jsx(primitives.IconLinkOutlineRegular, { size }); }
exports.inject = ["slots", "locale", "layout"];
exports.apply = function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, DICT), NS + ": dictionaries");
  const t = ctx.locale.bind(NS);
  ctx.slots.inject("main", () => ctx.slots.register({
    name: "main", key: "collab-devices", locale: NS,
    inject: () => ({ path: "collab/devices", title: t("label") }),
  }, EmbedPage));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist", id: "collab-devices", order: 9, locale: NS, label: () => t("label"),
  }, Icon));
  // #238: 「直到我断开」 must not become 「直到我离开这个面板」. The devices page publishes "1" on
  // this key while its list holds such a link — the only kind pairing.mjs sweeps once no window
  // beats (UNTIL_GRACE_MS) — and this window keeps it alive even after that page is unloaded. The
  // The list is read from the server before every beat, so a revoked or disconnected link makes
  // the window silent even when the devices page is closed. One window owns each beat: Web Locks
  // uses ifAvailable; browsers without Web Locks use the same local-storage lease as the page.
  ctx.effect(() => {
    const FLAG = NS + ": until-disconnect";
    const LEASE = NS + ": heartbeat";
    // 来源: dsh/collab/pairing.mjs ALIVE_EVERY_MS, the tick devices.html beats on as well.
    const EVERY_MS = 3000;
    const fetchImpl = globalThis.fetch;
    const everyTick = globalThis.setInterval;
    const stopTick = globalThis.clearInterval;
    const base = document.baseURI;
    const storage = globalThis.localStorage;
    const read = () => { try { return storage?.getItem(FLAG) ?? null; } catch (error) { return null; } };
    const write = (value) => { try { storage?.setItem(FLAG, value); } catch (error) {} };
    const LEASE_KEY = LEASE + ": holder";
    const owner = globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + "-" + Math.random();
    let holding = false;
    const readLease = () => { try { return JSON.parse(storage?.getItem(LEASE_KEY) ?? "null"); } catch (error) { return null; } };
    const writeLease = value => { try { storage?.setItem(LEASE_KEY, JSON.stringify(value)); } catch (error) {} };
    const claim = () => {
      const now = Date.now();
      const current = readLease();
      if (current && current.owner !== owner && current.expires > now) return false;
      // 来源: two ALIVE_EVERY_MS ticks, so a closed tab's fallback lease is reclaimed promptly.
      writeLease({ owner, expires: now + EVERY_MS * 2 });
      holding = readLease()?.owner === owner;
      return holding;
    };
    const release = () => { if (holding && readLease()?.owner === owner) { try { storage?.removeItem(LEASE_KEY); } catch (error) {} } };
    const getLinks = async () => {
      if (read() !== "1") return false;
      try {
        const res = await fetchImpl?.(new URL("collab/api/remote/links", base), { credentials: "same-origin" });
        const body = await res?.json();
        const active = Array.isArray(body?.links) && body.links.some(l => l.mode === "temp" && l.expires_at === null);
        write(active ? "1" : "0");
        return active;
      } catch (error) { return true; }
    };
    const pulse = async () => {
      if (!(await getLinks())) return;
      await fetchImpl?.(new URL("collab/api/remote/alive", base), { method: "POST", credentials: "same-origin" }).catch(() => {});
    };
    let holderTimer;
    const locks = globalThis.navigator?.locks;
    if (locks?.request) {
      const control = new AbortController();
      const acquire = () => { if (read() !== "1") return Promise.resolve(); return locks.request(LEASE, { mode: "exclusive", ifAvailable: true }, lock => {
        if (!lock) return;
        holderTimer = everyTick(pulse, EVERY_MS);
        void pulse();
        return new Promise(resolve => control.signal.addEventListener("abort", resolve, { once: true }));
      }).catch(() => {}); };
      const retryTimer = everyTick(acquire, EVERY_MS);
      void acquire();
      return () => { control.abort(); stopTick(retryTimer); stopTick(holderTimer); };
    }
    const acquire = async () => {
      if (read() !== "1" || (!holding && !claim())) return;
      if (holderTimer === undefined) {
        holderTimer = everyTick(pulse, EVERY_MS);
        void pulse();
      }
      writeLease({ owner, expires: Date.now() + EVERY_MS * 2 });
    };
    const retryTimer = everyTick(acquire, EVERY_MS);
    void acquire();
    return () => { stopTick(retryTimer); stopTick(holderTimer); release(); };
  }, NS + ": remote link heartbeat");
  if (location.hash === "#collab-devices") ctx.layout.selectPanel("collab-devices");
};

 return module.exports;
 }
});
