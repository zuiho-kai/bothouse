/**
 * 面板悬浮提示的契约测试 —— 钉住「body 层气泡、按光标摆位、离开/滚动收起、卸载回收」。
 *
 * 气泡不能画在消息列表里（列表是 overflow:auto，伪元素会被裁掉），这条一旦被改回 CSS 方案，
 * 表现是「贴顶的消息看不到提示」而不是报错，所以这里断言挂载点与摆位，而不只是「有没有元素」。
 *
 * 假 DOM 只实现本模块用到的成员（不引 jsdom）：class 用 Set 表示，`style` 是普通对象，
 * 元素没有排版，宽高直接给定值。
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { disposeTip, TIP_CLASS, tipAttrs } from './tooltip.ts';

/** 极简元素替身：`parentNode` 与 `remove()` 连通，用来验证「挂到 body / 从 body 摘掉」。 */
class FakeEl {
  readonly tag: string;
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeEl[] = [];
  parent: FakeEl | null = null;
  textContent = '';
  /** 假 DOM 没有排版：给固定宽高，摆位计算才有真实尺寸可用。 */
  offsetWidth = 80;
  offsetHeight = 26;

  constructor(tag: string) {
    this.tag = tag;
  }

  get parentNode(): FakeEl | null {
    return this.parent;
  }

  get classList(): {
    add: (name: string) => void;
    remove: (name: string) => void;
    contains: (name: string) => boolean;
  } {
    const classes = this.classes;
    return {
      add: (name) => void classes.add(name),
      remove: (name) => void classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  appendChild(el: FakeEl): void {
    el.parent = this;
    this.children.push(el);
  }

  removeChild(el: FakeEl): void {
    const index = this.children.indexOf(el);
    if (index >= 0) this.children.splice(index, 1);
    el.parent = null;
  }

  remove(): void {
    this.parent?.removeChild(this);
  }
}

/** 极简事件目标：记录监听，`fire()` 模拟一次派发。 */
class FakeTarget {
  readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const bucket = this.listeners.get(type) ?? new Set<() => void>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** 该类型当前挂着的监听数（用来验证卸载时确实摘干净）。 */
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

/** 极简 document 替身 + 视口尺寸。 */
class FakeWindow extends FakeTarget {
  innerWidth = 1280;
  innerHeight = 800;
}

/** 极简 document 替身。 */
class FakeDocument extends FakeTarget {
  readonly body = new FakeEl('body');

  createElement(tag: string): FakeEl {
    return new FakeEl(tag);
  }
}

/** 装一套假全局，返回 document 与还原函数。 */
function withFakeDom(): { doc: FakeDocument; win: FakeWindow; restore: () => void } {
  const doc = new FakeDocument();
  const win = new FakeWindow();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  (globalThis as { document?: unknown }).document = doc;
  (globalThis as { window?: unknown }).window = win;
  return {
    doc,
    win,
    restore: () => {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
  };
}

/** 当前挂在 body 上的气泡（按 class 认，不依赖下标）。 */
function tips(doc: FakeDocument): FakeEl[] {
  return doc.body.children.filter((el) => el.attrs.get('class') === TIP_CLASS);
}

afterEach(() => {
  disposeTip();
});

describe('tipAttrs —— 悬停时的 body 层气泡', () => {
  test('光标进入：在 body 上建一个 tooltip 气泡，正文与显隐状态就位', () => {
    const { doc, restore } = withFakeDom();
    try {
      const attrs = tipAttrs('播放这句');
      attrs.onMouseEnter({ clientX: 100, clientY: 100 });

      const bubble = tips(doc);
      assert.equal(bubble.length, 1, '气泡应该挂在 body 上（列表是滚动容器，挂在里面会被裁掉）');
      assert.equal(bubble[0].attrs.get('role'), 'tooltip');
      assert.equal(bubble[0].textContent, '播放这句');
      assert.equal(bubble[0].classList.contains('is-on'), true);
    } finally {
      restore();
    }
  });

  test('摆位：光标右下放得下就放右下，间隙 10px', () => {
    const { doc, restore } = withFakeDom();
    try {
      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      const bubble = tips(doc)[0];
      assert.equal(bubble.style.left, '110px');
      assert.equal(bubble.style.top, '110px');
    } finally {
      restore();
    }
  });

  test('摆位：光标贴右下角时翻到光标左上，不会伸出视口', () => {
    const { doc, restore } = withFakeDom();
    try {
      tipAttrs('播放这句').onMouseEnter({ clientX: 1270, clientY: 790 });
      const bubble = tips(doc)[0];
      // 1270 - 10 - 80 = 1180；790 - 10 - 26 = 754
      assert.equal(bubble.style.left, '1180px');
      assert.equal(bubble.style.top, '754px');
    } finally {
      restore();
    }
  });

  test('光标离开：只摘显隐，元素留着复用（悬停频繁，反复建删会闪）', () => {
    const { doc, restore } = withFakeDom();
    try {
      const attrs = tipAttrs('点开看大图');
      attrs.onMouseEnter({ clientX: 100, clientY: 100 });
      attrs.onMouseLeave();

      const bubble = tips(doc);
      assert.equal(bubble.length, 1);
      assert.equal(bubble[0].classList.contains('is-on'), false);
    } finally {
      restore();
    }
  });

  test('换一个触发元素再悬停：复用同一个气泡，正文换成新的', () => {
    const { doc, restore } = withFakeDom();
    try {
      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      tipAttrs('点开看大图').onMouseEnter({ clientX: 200, clientY: 100 });

      const bubble = tips(doc);
      assert.equal(bubble.length, 1);
      assert.equal(bubble[0].textContent, '点开看大图');
    } finally {
      restore();
    }
  });

  test('滚动或被按下：气泡立刻收起（fixed 定位不会跟着内容走，留着就错位）', () => {
    const { doc, win, restore } = withFakeDom();
    try {
      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      win.fire('scroll');
      assert.equal(tips(doc)[0].classList.contains('is-on'), false);

      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      doc.fire('pointerdown');
      assert.equal(tips(doc)[0].classList.contains('is-on'), false);
    } finally {
      restore();
    }
  });

  test('不接 focus：点击按钮也会获得焦点，接了会在大图/播放期间留一个撤不掉的气泡', () => {
    const attrs = tipAttrs('播放这句');
    assert.deepEqual(Object.keys(attrs).sort(), ['onMouseEnter', 'onMouseLeave']);
  });
});

describe('disposeTip —— 卸载回收', () => {
  test('摘掉气泡与全局监听，之后重新悬停能再建一个', () => {
    const { doc, win, restore } = withFakeDom();
    try {
      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      assert.equal(win.count('scroll'), 1);
      assert.equal(doc.count('pointerdown'), 1);

      disposeTip();
      assert.equal(tips(doc).length, 0, '气泡应该从 body 上摘掉');
      assert.equal(win.count('scroll'), 0);
      assert.equal(doc.count('pointerdown'), 0);

      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      assert.equal(tips(doc).length, 1, '卸载只是回收，不是停用');
      assert.equal(win.count('scroll'), 1, '监听不能重复叠加');
    } finally {
      restore();
    }
  });

  test('没显示过就卸载：不建元素、不报错', () => {
    const { doc, restore } = withFakeDom();
    try {
      disposeTip();
      assert.equal(doc.body.children.length, 0);
    } finally {
      restore();
    }
  });
});
