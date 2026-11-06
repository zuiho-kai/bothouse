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
  if (location.hash === "#collab-devices") ctx.layout.selectPanel("collab-devices");
};

 return module.exports;
 }
});
