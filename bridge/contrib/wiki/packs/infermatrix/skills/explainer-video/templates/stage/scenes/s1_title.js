// Title card: logo scales in from blur, underline sweeps, subtitle chips rise.
scene("s1_title", (root) => {
  const logo = place(el("div", "abs", `<span style="color:var(--cyan)">Project</span><span class="grad">Name</span>`, root), 0, 250, W);
  Object.assign(logo.style, { textAlign: "center", fontSize: "96px", fontWeight: 900, letterSpacing: "-.02em" });
  const line = place(el("div", "abs", "", root), 440, 380, 400, 2);
  line.style.background = "linear-gradient(90deg, transparent, var(--violet), var(--cyan), transparent)";
  const sub = place(el("div", "abs", `<span class="chip v">first claim</span> &nbsp; <span class="chip g">second claim</span>`, root), 0, 410, W);
  sub.style.textAlign = "center";
  return { logo, line, sub };
}, (t, c) => {
  const lk = span(t, .2, .9, ease.back);
  c.logo.style.opacity = span(t, .2, .6);
  c.logo.style.transform = `scale(${lerp(1.18, 1, lk)})`;
  c.logo.style.filter = `blur(${(1 - span(t, .2, .7)) * 10}px)`;
  c.line.style.transform = `scaleX(${span(t, .8, .7)})`;
  enter(c.sub, span(t, 1.3, .6), 14);
}, ["rgba(169,139,255,.20)", "rgba(56,208,255,.14)"]);
