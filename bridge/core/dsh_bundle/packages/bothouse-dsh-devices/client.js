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
  // flag is re-read on every beat, so an empty or 「记住」-only list goes silent again at once.
  // One window holds the lease and beats; the page and every other window ask for it with
  // ifAvailable and stand down, so N open windows (and an open panel) still send one beat.
  ctx.effect(() => {
    const FLAG = NS + ": until-disconnect";
    const LEASE = NS + ": heartbeat";
    // 来源: dsh/collab/pairing.mjs ALIVE_EVERY_MS, the tick devices.html beats on as well.
    const EVERY_MS = 3000;
    const fetchImpl = globalThis.fetch;
    const everyTick = globalThis.setInterval;
    const stopTick = globalThis.clearInterval;
    const base = document.baseURI;
    const read = () => { try { return globalThis.localStorage?.getItem(FLAG) ?? null; } catch (error) { return null; } };
    const write = (value) => { try { globalThis.localStorage?.setItem(FLAG, value); } catch (error) { /* no storage: the open page keeps beating for itself */ } };
    const beat = () => {
      if (read() !== "1") return;
      fetchImpl?.(new URL("collab/api/remote/alive", base), { method: "POST", credentials: "same-origin" }).catch(() => {});
    };
    // A window opened after the link is gone still sees the last published flag (temp links live
    // in memory only, so a DSH restart drops them): confirm it once against the list, then trust
    // the page, which publishes on every list read.
    const seed = async () => {
      if (read() !== "1") return;
      try {
        const res = await fetchImpl?.(new URL("collab/api/remote/links", base), { credentials: "same-origin" });
        const body = await res?.json();
        const links = Array.isArray(body?.links) ? body.links : [];
        write(links.some(l => l.mode === "temp" && l.expires_at === null) ? "1" : "0");
      } catch (error) { /* no answer: keep whatever the page last published */ }
    };
    let timer;
    const run = () => { timer = everyTick(beat, EVERY_MS); };
    const locks = globalThis.navigator?.locks;
    // No Web Locks (an old browser): beat anyway rather than let the link lapse.
    if (locks?.request === undefined) { run(); return () => stopTick(timer); }
    const control = new AbortController();
    locks.request(LEASE, { mode: "exclusive", signal: control.signal }, () => {
      run();
      seed();
      return new Promise(() => {}); // held until this window closes; the next window then takes over
    }).catch(() => { /* aborted: this window is closing */ });
    return () => { control.abort(); stopTick(timer); };
  }, NS + ": remote link heartbeat");
  if (location.hash === "#collab-devices") ctx.layout.selectPanel("collab-devices");
};

 return module.exports;
 }
});
