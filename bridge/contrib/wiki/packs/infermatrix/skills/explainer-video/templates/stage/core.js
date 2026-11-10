// Deterministic timeline: every frame is a pure function of t, so preview and capture match.
const W = 1280, H = 720;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = {
  out: k => 1 - Math.pow(1 - k, 3),
  inOut: k => (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  back: k => { const c = 1.6; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
};
// eased progress inside [a, a + d]
const span = (t, a, d, e = ease.out) => e(clamp((t - a) / d));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, cls, html, parent) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  if (parent) parent.appendChild(n);
  return n;
}
function place(n, x, y, w, h) {
  Object.assign(n.style, { left: x + "px", top: y + "px" });
  if (w != null) n.style.width = w + "px";
  if (h != null) n.style.height = h + "px";
  return n;
}
// entrance: opacity + vertical offset + optional scale
function enter(n, k, dy = 18, s0 = 1) {
  n.style.opacity = k;
  n.style.transform = `translateY(${(1 - k) * dy}px) scale(${lerp(s0, 1, k)})`;
}
// typewriter that keeps HTML tags intact
function typeHTML(html, k) {
  const total = html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, "x").length;
  let left = Math.floor(total * clamp(k)), out = "", i = 0;
  while (i < html.length && left > 0) {
    if (html[i] === "<") { const j = html.indexOf(">", i); out += html.slice(i, j + 1); i = j + 1; continue; }
    if (html[i] === "&") { const j = html.indexOf(";", i); out += html.slice(i, j + 1); i = j + 1; left--; continue; }
    out += html[i++]; left--;
  }
  // close any open spans so styles do not leak
  const open = (out.match(/<span[^>]*>/g) || []).length - (out.match(/<\/span>/g) || []).length;
  return out + "</span>".repeat(Math.max(0, open));
}
// rolling number counter
const countTo = (v, k, dec = 0) => (v * clamp(k)).toFixed(dec);

// scene registry: build(root, meta) runs once; render(t, ctx, meta) runs every frame with scene-local t
const SCENES = [];
function scene(id, build, render, tint) { SCENES.push({ id, build, render, tint }); }

// seeded pseudo-random in [0, 1); never use Math.random() in a scene
const rand = i => { const r = Math.sin(i * 12.9898) * 43758.5453; return r - Math.floor(r); };

// background: dark grid + drifting glows + sparse particles
const BG = (() => {
  const cv = document.getElementById("bg"), g = cv.getContext("2d");
  const sx = cv.width / W;
  const pts = Array.from({ length: 70 }, (_, i) => ({ x: rand(i) * W, y: rand(i + 99) * H, s: .4 + rand(i) * 1.4, v: 4 + rand(i + 99) * 10 }));
  return function draw(t, tint) {
    g.setTransform(sx, 0, 0, sx, 0, 0);
    g.fillStyle = "#04060c"; g.fillRect(0, 0, W, H);
    const glow = (x, y, r, c) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
    glow(W * .22 + Math.sin(t * .13) * 80, H * .3, 620, tint[0]);
    glow(W * .82 + Math.cos(t * .11) * 70, H * .78, 560, tint[1]);
    g.strokeStyle = "rgba(90,120,200,.07)"; g.lineWidth = 1;
    const off = (t * 6) % 48;
    for (let x = -48 + off; x < W; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    for (const p of pts) {
      const y = (p.y - t * p.v + H * 10) % H;
      g.fillStyle = `rgba(150,190,255,${.12 + p.s * .1})`;
      g.fillRect(p.x, y, p.s, p.s);
    }
    const vg = g.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, W * .75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.6)");
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  };
})();
