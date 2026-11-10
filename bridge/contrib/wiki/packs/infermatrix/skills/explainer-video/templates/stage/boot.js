// Assemble scenes and expose window.renderAt(t) for both preview and frame capture.
(() => {
  const root = document.getElementById("scenes");
  const tl = window.TL;
  const byId = Object.fromEntries(tl.scenes.map(s => [s.id, s]));
  const FADE = 0.45;
  const DEFAULT_TINT = ["rgba(56,208,255,.12)", "rgba(169,139,255,.12)"];

  const missing = tl.scenes.map(s => s.id).filter(id => !SCENES.some(s => s.id === id));
  if (missing.length) throw new Error("no scene script for: " + missing.join(", "));
  const ordered = SCENES.map(s => {
    const meta = byId[s.id];
    if (!meta) throw new Error("timeline has no scene " + s.id);
    return { ...s, meta };
  }).sort((a, b) => a.meta.start - b.meta.start);
  // 按时间轴创建 DOM，让叠放顺序与转场顺序保持一致。
  const live = ordered.map(s => {
    const meta = s.meta;
    const node = el("div", "scene", null, root);
    node.dataset.id = s.id;
    const ctx = s.build(node, meta) || {};
    return { ...s, meta, node, ctx };
  });

  const cap = $("#cap"), tc = $("#tc"), idx = $("#sceneidx"), prog = $("#prog"), flash = $("#flash");
  const lines = tl.scenes.flatMap(s => s.lines);

  window.renderAt = function (t) {
    let active = live[0];
    for (const s of live) {
      const a = s.meta.start, b = a + s.meta.len;
      // crossfade: the next scene starts FADE seconds early
      const vis = clamp((t - a + FADE) / FADE) * clamp((b + FADE - t) / FADE);
      const on = vis > 0.001;
      s.node.style.display = on ? "block" : "none";
      if (!on) continue;
      s.node.style.opacity = vis;
      if (t >= a - FADE && t < b) active = s;
      s.render(clamp(t - a, -FADE, s.meta.len + FADE), s.ctx, s.meta);
    }
    BG(t, active.tint || DEFAULT_TINT);

    // captions follow narration timing with a short fade
    const line = lines.find(l => t >= l.start - .1 && t < l.start + l.dur + .25);
    if (line) {
      if (cap.dataset.k !== line.file) { cap.innerHTML = line.cap; cap.dataset.k = line.file; }
      cap.style.opacity = Math.min(clamp((t - line.start + .1) / .2), clamp((line.start + line.dur + .25 - t) / .2));
    } else cap.style.opacity = 0;

    // HUD
    const fr = Math.floor((t % 1) * tl.fps), sec = Math.floor(t);
    tc.textContent = `00:${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}:${String(fr).padStart(2, "0")}`;
    idx.textContent = `${String(live.indexOf(active) + 1).padStart(2, "0")} / ${String(live.length).padStart(2, "0")}`;
    prog.style.width = (t / tl.total * 100) + "%";

    // scan-line flash at scene cuts
    let f = 0;
    for (const s of live.slice(1)) f = Math.max(f, 1 - Math.abs(t - s.meta.start) / .28);
    flash.style.opacity = clamp(f) * .9;
    flash.style.transform = `translateY(${(t * 900) % 720 - 360}px)`;
  };

  // preview: ?t=seconds freezes a frame; default plays in real time; ?capture=1 waits for renderAt calls
  const q = new URLSearchParams(location.search);
  if (q.has("t")) renderAt(parseFloat(q.get("t")));
  else if (!q.has("capture")) {
    const t0 = performance.now();
    const loop = () => { renderAt(((performance.now() - t0) / 1000) % tl.total); requestAnimationFrame(loop); };
    loop();
  } else renderAt(0);
  window.READY = true;
})();
