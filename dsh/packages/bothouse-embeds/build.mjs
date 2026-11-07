// Generates the three small DSH client packages that each put one bothouse page in the DSH
// sidebar: team desk, bothouse panel (with the wiki galaxy sub-page), other computers.
// Each is its own package because DSH loads one browser half per package; one package per
// page lets the Plugins page switch each page on and off with DSH's own row switch (#1044).
// The channels page stays in client-ui-discord. Plain JS on purpose: each page is an iframe
// of a collab host page, so there is nothing for tsdown to build.
// Usage: node build.mjs [outDir]   (writes <outDir>/<package>/…; default: dsh/packages, the committed copy)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dirname
const out = process.argv[2] ?? join(here, '..')
const uiPkg = JSON.parse(readFileSync(join(here, '../client-ui-discord/package.json'), 'utf8'))

// order keeps them right under Channels (order 5), as before the split.
export const PAGES = [
  {
    pkg: 'bothouse-dsh-desk', id: 'collab-desk', path: 'collab/desk', order: 6, icon: 'IconChecklistOutlineRegular',
    zh: { label: '团队工作台', desc: '任务和事件的实时看板。' },
    en: { label: 'Team desk', desc: 'Live board of tasks and events.' },
  },
  {
    pkg: 'bothouse-dsh-panel', id: 'bothouse-panel', path: 'collab/panel/', order: 7, icon: 'IconGaugeOutlineRegular',
    // Same name in the sidebar and on the Plugins page; the plugin itself is called bothouse.
    zh: { label: 'bothouse 面板', desc: 'bothouse 管理面板：角色、用量、Wiki 星河。' },
    en: { label: 'bothouse panel', desc: 'bothouse management panel: roles, usage, wiki galaxy.' },
    // #145: the galaxy is a page inside the panel; a bookmark that still says #wiki-galaxy opens it.
    galaxy: { id: 'wiki-galaxy', path: 'collab/panel/wiki-galaxy', zh: 'Wiki 星河', en: 'Wiki galaxy' },
  },
  {
    pkg: 'bothouse-dsh-devices', id: 'collab-devices', path: 'collab/devices', order: 9, icon: 'IconLinkOutlineRegular',
    zh: { label: '其他电脑', desc: '用一次性号码配对另一台电脑，操作它的频道、工作台和面板。' },
    en: { label: 'Other computers', desc: 'Pair another computer by a one-time number and drive its channels, desk and panel.' },
    // #238: keep 「直到我断开」 links alive from the window, not just from the open page. Switching to
    // another panel unloads devices.html, and pairing.mjs sweeps a link whose window stopped beating
    // after UNTIL_GRACE_MS — 「直到我断开」 must not become 「直到我离开这个面板」.
    // 来源：dsh/collab/pairing.mjs ALIVE_EVERY_MS，与 devices.html 的页面心跳同一个节拍。
    heartbeat: 3000,
  },
]

function clientBody(page) {
  const dict = { zh: { label: page.zh.label }, en: { label: page.en.label } }
  if (page.galaxy) { dict.zh.galaxy = page.galaxy.zh; dict.en.galaxy = page.galaxy.en }
  const ns = page.pkg
  return `"use strict";
const { jsx } = require("react/jsx-runtime");
const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
const NS = ${JSON.stringify(ns)};
const DICT = ${JSON.stringify(dict)};
const BG = "var(--dsw-alias-bg-base)";
// Same frame as client-ui-discord EmbedPage: same-origin page, relative to document.baseURI so
// the panel proxy's /dsh/ prefix is kept. Same-origin Referer lets the proxy verify
// a port-less Origin; cross-origin destinations still receive no Referer.
function EmbedPage({ path, title }) {
  const src = new URL(path, document.baseURI).toString();
  return jsx("div", { style: { boxSizing: "border-box", display: "flex", width: "100%", height: "100%", minHeight: 0, paddingTop: "var(--dsh-frame-top-clearance, 0px)", background: BG },
    children: jsx("iframe", { src, title, loading: "lazy", referrerPolicy: "same-origin", style: { flex: 1, width: "100%", height: "100%", border: 0, background: BG } }) });
}
function Icon({ size }) { return jsx(primitives.${page.icon}, { size }); }
exports.inject = ["slots", "locale", "layout"];
exports.apply = function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, DICT), NS + ": dictionaries");
  const t = ctx.locale.bind(NS);
  ctx.slots.inject("main", () => ctx.slots.register({
    name: "main", key: ${JSON.stringify(page.id)}, locale: NS,
    inject: () => ({ path: ${JSON.stringify(page.path)}, title: t("label") }),
  }, EmbedPage));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist", id: ${JSON.stringify(page.id)}, order: ${page.order}, locale: NS, label: () => t("label"),
  }, Icon));
${page.galaxy ? `  ctx.slots.inject("main", () => ctx.slots.register({
    name: "main", key: ${JSON.stringify(page.galaxy.id)}, locale: NS,
    inject: () => ({ path: ${JSON.stringify(page.galaxy.path)}, title: t("galaxy") }),
  }, EmbedPage));
  // After the registrations: selecting a panel whose main entry is not registered yet fails.
  if (location.hash === "#${page.galaxy.id}") ctx.layout.selectPanel(${JSON.stringify(page.galaxy.id)});
` : ''}${page.heartbeat ? `  // #238: 「直到我断开」 must not become 「直到我离开这个面板」. The devices page publishes "1" on
  // this key while its list holds such a link — the only kind pairing.mjs sweeps once no window
  // beats (UNTIL_GRACE_MS) — and this window keeps it alive even after that page is unloaded. The
  // flag is re-read on every beat, so an empty or 「记住」-only list goes silent again at once.
  // One window holds the lease and beats; the page and every other window ask for it with
  // ifAvailable and stand down, so N open windows (and an open panel) still send one beat.
  ctx.effect(() => {
    const FLAG = NS + ": until-disconnect";
    const LEASE = NS + ": heartbeat";
    // 来源: dsh/collab/pairing.mjs ALIVE_EVERY_MS, the tick devices.html beats on as well.
    const EVERY_MS = ${page.heartbeat};
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
` : ''}  if (location.hash === "#${page.id}") ctx.layout.selectPanel(${JSON.stringify(page.id)});
};
`
}

function wrap(name, body) {
  return `window.__ModuleLoader__.load({
 id: ${JSON.stringify(name)},
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
${body}
 return module.exports;
 }
});
`
}

const version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version
for (const page of PAGES) {
  const dir = join(out, page.pkg)
  mkdirSync(join(dir, 'locale'), { recursive: true })
  const pkg = {
    name: page.pkg,
    version,
    description: page.en.desc,
    type: 'module',
    main: './index.js',
    // ./locale/*.json: the Plugins page reads each row's title and description from there.
    exports: { '.': './index.js', './client': './client.js', './locale/*.json': './locale/*.json', './package.json': './package.json' },
    license: 'Apache-2.0',
    files: ['index.js', 'client.js', 'locale/*.json'],
    dsh: { client: { inject: uiPkg.dsh.client.inject, platform: 'web' } },
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  writeFileSync(join(dir, 'index.js'), '// Host half: nothing; the page lives entirely in ./client.js.\nexport function apply() {}\n')
  writeFileSync(join(dir, 'client.js'), wrap(page.pkg, clientBody(page)))
  for (const lang of ['zh', 'en']) {
    writeFileSync(join(dir, 'locale', `${lang}.json`), JSON.stringify({ meta: { title: page[lang].title ?? page[lang].label, description: page[lang].desc } }, null, 2) + '\n')
  }
}
console.log(`bothouse-embeds: wrote ${PAGES.map(p => p.pkg).join(', ')} to ${out}`)
