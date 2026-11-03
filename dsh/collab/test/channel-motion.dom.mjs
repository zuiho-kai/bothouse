// U3 频道页交互的测试垫片：一个够用的极简 DOM，让 dsh/collab/page.html 里的内联脚本
// 能在 node 里跑起来。只实现页面实际用到的那部分（getElementById / createElement /
// append / querySelector / dataset / classList / 事件），不追求通用性。
//
// 为什么不用 jsdom：本仓库 dsh/collab 没有前端测试依赖，加依赖要改 lockfile 并过 CI；
// 这里的垫片只为验证交互逻辑（补全、未读、重试、Esc），不渲染样式。

const SPLIT = s => String(s || '').split(/\s+/).filter(Boolean);

export class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.text = '';
    this._class = '';
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.selectionStart = 0;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
  }
  get className() { return this._class; }
  set className(v) { this._class = String(v || ''); }
  get classList() {
    const self = this;
    return {
      add: (...c) => { self._class = [...new Set([...SPLIT(self._class), ...c])].join(' '); },
      remove: (...c) => { self._class = SPLIT(self._class).filter(x => !c.includes(x)).join(' '); },
      contains: c => SPLIT(self._class).includes(c),
      toggle: (c, on) => { if (on === undefined) on = !SPLIT(self._class).includes(c); on ? self.classList.add(c) : self.classList.remove(c); },
    };
  }
  get textContent() {
    if (this.children.length) return this.children.map(c => c.textContent).join('');
    return this.text;
  }
  set textContent(v) { this.children = []; this.text = v == null ? '' : String(v); }
  append(...nodes) {
    for (const n of nodes) { if (n == null) continue; const node = typeof n === 'string' ? new El('span') : n; if (node.text === undefined) node.text = ''; if (typeof n === 'string') node.text = n; node.parent = this; this.children.push(node); }
  }
  replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
  insertBefore(node, ref) {
    node.parent = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  replaceWith(node) { node.parent = this.parent; const p = this.parent; if (!p) return; p.children = p.children.map(c => (c === this ? node : c)); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'hidden') this.hidden = true; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { const a = this.listeners.get(type) || []; a.push(fn); this.listeners.set(type, a); }
  // 页面用 node.onclick = fn 的写法，这里转成事件监听，测试里 dispatch('click') 就能触发
  set onclick(fn) { this.addEventListener('click', fn); }
  dispatch(type, event = {}) {
    const ev = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...event };
    for (const fn of this.listeners.get(type) || []) fn(ev);
    return ev;
  }
  focus() { this.focused = true; }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  scrollIntoView() {}
  requestSubmit() { this.dispatch('submit'); }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function matches(node, sel) {
  const s = sel.trim();
  if (s.startsWith('[data-')) {
    const m = /^\[data-([\w-]+)="([^"]*)"\]$/.exec(s);
    if (!m) return false;
    const key = m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
    return String(node.dataset[key]) === m[2];
  }
  if (s.startsWith('.')) return SPLIT(node._class).includes(s.slice(1));
  return node.tagName === s.toUpperCase();
}

/** 建立页面：按 page.html 里出现的 id 造扁平元素，返回 document 与导航辅助。 */
export function makeDocument(ids) {
  const byId = new Map();
  for (const id of ids) byId.set(id, new El('div'));
  // 抽屉用 document.body.dataset.drawer 记状态，Esc 解除，所以要有 body 与 activeElement
  const body = new El('body');
  const document = {
    body,
    activeElement: body,
    getElementById: id => byId.get(id) || null,
    createElement: tag => new El(tag),
    addEventListener() {},
  };
  return { document, byId };
}

export function textOfIds() { return []; }
