// 公共叠加层：大字卡 + 左上角品牌标志。模板 <script src="common.js"></script> 引入，开播时调 BH.overlay()。
// 读 window.SCENE / window.LANG：
//   SCENE.headline {zh,en}：画面中上方大字卡，SCENE.headline_at 毫秒后弹出（默认 300）并停住。
//   SCENE.brand true：左上角小号 bothouse 标志，全片统一样式。
// 底部 80px 留给后期烧字幕，叠加层不往那里放东西（来源：派活要求「底部 80px 留给后期烧字幕」）。
(function () {
  const L = () => window.LANG || 'en';
  const t = v => (v && typeof v === 'object') ? (v[L()] ?? v.en ?? '') : (v ?? '');
  const css = `
  .bh-headline { position:fixed; top:34px; left:0; right:0; text-align:center; z-index:50; pointer-events:none;
    color:#fff; font:800 50px/1.15 -apple-system,"Helvetica Neue","PingFang SC","Noto Sans CJK SC","Microsoft YaHei",Arial,sans-serif;
    letter-spacing:1px; text-shadow:0 4px 24px rgba(0,0,0,.55); opacity:0; transform:scale(.6) translateY(10px); }
  .bh-headline.on { animation:bh-pop .55s cubic-bezier(.34,1.56,.64,1) forwards; }
  @keyframes bh-pop { 0% { opacity:0; transform:scale(.6) translateY(10px); } 100% { opacity:1; transform:none; } }
  .bh-brand { position:fixed; top:22px; left:26px; z-index:50; display:flex; align-items:center; gap:9px; pointer-events:none;
    color:#fff; font:700 19px/1 -apple-system,"Helvetica Neue",Arial,sans-serif; letter-spacing:.3px; opacity:.92; }
  .bh-brand svg { width:26px; height:26px; flex:none; }
  `;
  // 小房子图形 + 两个对话点，代表 bothouse
  const logo = `<svg viewBox="0 0 26 26"><path d="M3 12 L13 3 L23 12 V23 H3 Z" fill="#5865f2"/><circle cx="9.5" cy="16" r="2" fill="#fff"/><circle cx="16.5" cy="16" r="2" fill="#fff"/></svg>`;
  function overlay() {
    const S = window.SCENE || {};
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    if (S.brand) {
      const b = document.createElement('div'); b.className = 'bh-brand';
      b.innerHTML = logo + '<span>bothouse</span>'; document.body.appendChild(b);
    }
    if (S.headline) {
      const h = document.createElement('div'); h.className = 'bh-headline'; h.textContent = t(S.headline);
      document.body.appendChild(h);
      // 默认 300ms，来源：派活要求「SCENE.headline_at 毫秒（默认 300）」
      setTimeout(() => h.classList.add('on'), S.headline_at ?? 300);
    }
  }
  window.BH = { overlay, t };
})();
