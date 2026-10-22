// v4 宣传片公用小工具：取双语字段、等待、标志、名字条、纸飞机、星星。模板用 <script src="v4.js"></script> 引入。
// SVG 路径坐标是画面图形（标志照抄 common.js，纸飞机照 home-v6.png 外形画），不是可调参数；尺寸由调用方给。
(function () {
  const L = () => window.LANG || 'en';
  const t = v => (v && typeof v === 'object') ? (v[L()] ?? v.en ?? '') : (v ?? '');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  // 小房子 + 两个对话点：路径照抄 common.js 的 bothouse 标志，颜色换成橘黄
  const houseSvg = px => `<svg width="${px}" height="${px}" viewBox="0 0 26 26"><path d="M3 12 L13 3 L23 12 V23 H3 Z" fill="#f08a24" stroke="#3b2a18" stroke-width="1.4" stroke-linejoin="round"/><circle cx="9.5" cy="16" r="2" fill="#fff"/><circle cx="16.5" cy="16" r="2" fill="#fff"/></svg>`;
  const logo = px => `<div class="logo">${houseSvg(px)}<span>bot<em>house</em></span></div>`;
  // 名字条：role = { en, zh, color }（color 可以是 CSS 渐变）
  const tag = r => `<div class="tag" style="--c:${r.color}"><b>${r.en}</b><i>${t(r.zh)}</i></div>`;
  // 纸飞机（侧视）：白色带深棕描边，机身可写一行字；图形坐标系 200×110（照 home-v6.png 外形画）
  const planeSvg = (w, text) => `<svg width="${w}" height="${w * 110 / 200}" viewBox="0 0 200 110">
    <path d="M4 70 L196 8 L70 100 Z" fill="#fff" stroke="#3b2a18" stroke-width="3" stroke-linejoin="round"/>
    <path d="M70 100 L84 66 L196 8" fill="#f3ead8" stroke="#3b2a18" stroke-width="3" stroke-linejoin="round"/>
    <path d="M4 70 L84 66" fill="none" stroke="#3b2a18" stroke-width="2.5"/>
    ${text ? `<text x="92" y="84" font-size="20" font-weight="700" fill="#f08a24" font-family="BHRound,PingFang SC,sans-serif" transform="rotate(-18 92 84)">${text}</text>` : ''}</svg>`;
  // 在容器里撒小星星，位置由场景给定（不随机，两次渲染一样）
  const sparks = (box, pts) => pts.forEach(([x, y, s, d]) => {
    const e = el('div', 'spark'); Object.assign(e.style, { left: x + 'px', top: y + 'px', scale: String(s || 1), animationDelay: (d || 0) + 's' }); box.appendChild(e);
  });
  const start = () => { window.__start = Date.now(); };
  const done = () => { window.__done = true; };
  window.V4 = { t, wait, el, logo, houseSvg, tag, planeSvg, sparks, start, done };
})();
