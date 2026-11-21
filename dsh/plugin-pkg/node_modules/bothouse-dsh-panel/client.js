window.__ModuleLoader__.load({
 id: "bothouse-dsh-panel",
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
"use strict";
const { jsx } = require("react/jsx-runtime");
const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
const NS = "bothouse-dsh-panel";
const DICT = {"zh":{"label":"bothouse 面板","galaxy":"Wiki 星河"},"en":{"label":"bothouse panel","galaxy":"Wiki galaxy"}};
const BG = "var(--dsw-alias-bg-base)";
// Same frame as client-ui-discord EmbedPage: same-origin page, relative to document.baseURI so
// the panel proxy's /dsh/ prefix is kept. Same-origin Referer lets the proxy verify
// a port-less Origin; cross-origin destinations still receive no Referer.
function EmbedPage({ path, title }) {
  const src = new URL(path, document.baseURI).toString();
  return jsx("div", { style: { boxSizing: "border-box", display: "flex", width: "100%", height: "100%", minHeight: 0, paddingTop: "var(--dsh-frame-top-clearance, 0px)", background: BG },
    children: jsx("iframe", { src, title, loading: "lazy", referrerPolicy: "same-origin", style: { flex: 1, width: "100%", height: "100%", border: 0, background: BG } }) });
}
function Icon({ size }) { return jsx(primitives.IconGaugeOutlineRegular, { size }); }
exports.inject = ["slots", "locale", "layout"];
exports.apply = function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, DICT), NS + ": dictionaries");
  const t = ctx.locale.bind(NS);
  ctx.slots.inject("main", () => ctx.slots.register({
    name: "main", key: "bothouse-panel", locale: NS,
    inject: () => ({ path: "collab/panel/", title: t("label") }),
  }, EmbedPage));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist", id: "bothouse-panel", order: 7, locale: NS, label: () => t("label"),
  }, Icon));
  ctx.slots.inject("main", () => ctx.slots.register({
    name: "main", key: "wiki-galaxy", locale: NS,
    inject: () => ({ path: "collab/panel/wiki-galaxy", title: t("galaxy") }),
  }, EmbedPage));
  // After the registrations: selecting a panel whose main entry is not registered yet fails.
  if (location.hash === "#wiki-galaxy") ctx.layout.selectPanel("wiki-galaxy");
  if (location.hash === "#bothouse-panel") ctx.layout.selectPanel("bothouse-panel");
};

 return module.exports;
 }
});
