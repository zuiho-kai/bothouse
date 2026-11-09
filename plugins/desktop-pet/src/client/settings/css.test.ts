/**
 * 设置页样式注入（src/client/settings/css.ts）的契约测试。
 *
 * 两条契约：
 *   1. 幂等：同一页面反复渲染设置页只留一个 `<style>`，去重标记打在 `data-plugin-css` 上；
 *   2. 无 DOM 安全：没有 document（SSR 或纯单测环境）时静默返回，不让设置页整页崩掉。
 *
 * 假 DOM 只实现本模块用到的成员（不引 jsdom）：选择器只支持 `tag` / `[attr]` / `[attr="v"]` 三种形态。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { injectSettingsCss } from './css.ts';

/** 极简元素替身：`dataset` 写回 `data-*` 属性，与真实 DOM 一致。 */
class El {
  readonly tag: string;
  readonly attrs = new Map<string, string>();
  readonly children: El[] = [];
  readonly dataset: Record<string, string>;
  ownText = '';

  constructor(tag: string) {
    this.tag = tag;
    const name = (key: string): string => 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    // 读写都走属性表：真实 DOM 里 dataset 就是 data-* 的视图，模块写完标记后查重读的是同一份。
    this.dataset = new Proxy({} as Record<string, string>, {
      set: (_target, key, value: string) => {
        this.attrs.set(name(String(key)), value);
        return true;
      },
      get: (_target, key) => this.attrs.get(name(String(key))),
    });
  }

  get textContent(): string {
    return this.ownText;
  }

  set textContent(value: string) {
    this.ownText = value;
  }

  appendChild(node: El): void {
    this.children.push(node);
  }

  querySelector(selector: string): El | null {
    return this.children.flatMap((child) => [child, ...child.children]).find((el) => matches(el, selector)) ?? null;
  }
}

/** 支持 `tag` / `[attr]` / `[attr="v"]` 三种形态。 */
function matches(el: El, selector: string): boolean {
  const parsed = /^([a-z]*)(?:\[([a-zA-Z-]+)(?:="([^"]*)")?\])?$/.exec(selector);
  if (parsed === null) throw new Error('假 DOM 不支持的 selector：' + selector);
  const [, tag, attr, value] = parsed;
  if (tag !== '' && el.tag !== tag) return false;
  if (attr === undefined) return true;
  const actual = el.attrs.get(attr);
  if (actual === undefined) return false;
  return value === undefined ? true : actual === value;
}

/** 极简 document 替身：只提供 head、createElement 与顶层 querySelector。 */
class FakeDocument {
  readonly head = new El('head');

  createElement(tag: string): El {
    return new El(tag);
  }

  querySelector(selector: string): El | null {
    return this.head.querySelector(selector);
  }
}

/** 装一套假 DOM，返回 document 与还原函数。 */
function withFakeDom(): { doc: FakeDocument; restore: () => void } {
  const doc = new FakeDocument();
  const previous = globalThis.document;
  (globalThis as { document?: unknown }).document = doc;
  return {
    doc,
    restore: () => {
      (globalThis as { document?: unknown }).document = previous;
    },
  };
}

describe('injectSettingsCss —— 设置页样式注入', () => {
  test('首次注入：head 里出现一个带 dsh-pet 标记的 style，且两族类名都在', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSettingsCss();
      assert.equal(doc.head.children.length, 1, '应只注入一个 style');
      const [tag] = doc.head.children;
      assert.equal(tag.tag, 'style');
      assert.equal(tag.dataset.plugin, 'dsh-pet');
      assert.equal(tag.dataset.pluginCss, 'dsh-pet/settings.css');
      assert.ok(tag.textContent.includes('.dsh-pet-mp__trigger'), '模型选择器的样式必须在');
      assert.ok(tag.textContent.includes('.dsh-pet-cfg__inp'), '配置卡片表单的样式必须在');
    } finally {
      restore();
    }
  });

  test('重复注入：第二、三次调用都不再插入 style', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSettingsCss();
      injectSettingsCss();
      injectSettingsCss();
      assert.equal(doc.head.children.length, 1, '去重标记失效会重复插入，样式规则成倍堆积');
    } finally {
      restore();
    }
  });

  test('没有 document：静默返回，不抛', () => {
    assert.doesNotThrow(() => injectSettingsCss(), '无 DOM 环境下注入必须是空操作');
  });
});
