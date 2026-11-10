// Points scene: a heading, then cards that enter in sequence timed to the narration lines.
scene("s2_points", (root, meta) => {
  const head = place(el("div", "abs title", "One claim per scene", root), 96, 96);
  const items = [
    ["01", "Typed code", "typeHTML reveals code or text"],
    ["02", "Counter", "countTo rolls a number"],
    ["03", "Status", "chips label evidence strength"],
  ];
  const cards = items.map(([n, h, d], i) => place(el("div", "win", `
    <div style="padding:22px">
      <div class="mono" style="font-size:40px;font-weight:800;color:var(--cyan)">${n}</div>
      <div style="font-size:26px;font-weight:800;margin-top:8px">${h}</div>
      <div style="font-size:17px;color:var(--muted);margin-top:8px">${d}</div>
    </div>`, root), 96 + i * 370, 200, 340, 220));
  // cue cards to the second narration line when there is one
  const cue = (meta.lines[1] || meta.lines[0]).start - meta.start;
  return { head, cards, cue };
}, (t, c) => {
  enter(c.head, span(t, 0, .6));
  c.cards.forEach((n, i) => enter(n, span(t, .5 + i * .25, .6), 24, .96));
  c.cards[1].querySelector(".mono").textContent = countTo(42, span(t, c.cue, 1.2));
});
