/**
 * 落盘位置两张卡（src/client/settings/paths-cards.ts）的契约测试。
 *
 * 三条契约：
 *   1. 默认收起，但正文仍挂在树上（只是高度被裁到 0）——收起不该丢内容；
 *   2. 标题按钮的 `aria-expanded` / `aria-controls` 与正文 id 成对，且点击是取反；
 *   3. 问号在按钮内部但自己拦掉冒泡：点它只出气泡，不连带开合。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import type { ConfigMeta } from './config/index.ts';
import { makePathsCards } from './paths-cards.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/** 假 useState：折叠态由用例给定，setter 只记录回传值、不触发重渲染。 */
function fakeState(initial: boolean, seen: boolean[]) {
  return (() => [initial, (next: boolean) => seen.push(next)]) as never;
}

/** 造一对卡；`initial` 是两张卡共用的初始开合态。 */
function make(initial: boolean, seen: boolean[] = []) {
  return makePathsCards({ h, t: (key: string) => key, useState: fakeState(initial, seen) } as never);
}

const meta: ConfigMeta = {
  user: 'D:/u/config.jsonc',
  default: 'D:/p/assets/config.jsonc',
  animations: 'D:/u/animations',
  memes: 'D:/u/memes',
  logs: 'D:/u/pet.log',
  profile: 'default',
  storage: [
    { key: 'config', path: 'D:/u/config.jsonc', exists: true },
    { key: 'cache', path: 'D:/u/cache', exists: false },
  ],
};

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const byClass = (tree: unknown, cls: string): Node | undefined =>
  flatten(tree).find((node) => String(node.props?.className ?? '').includes(cls));

const byId = (tree: unknown, id: string): Node | undefined => flatten(tree).find((node) => node.props?.id === id);

describe('paths-cards —— 折叠卡', () => {
  test('默认收起：按钮 aria-expanded 为 false，正文在树上但 aria-hidden', () => {
    const tree = make(false).ConfigMetaCard({ paths: meta });
    const button = byClass(tree, 'dsh-pet-cfg__foldToggle');
    assert.ok(button);
    assert.equal(button.props['aria-expanded'], false);
    assert.equal(button.props['aria-controls'], 'pet-cfg-paths-meta');
    // 正文内容照旧渲染：收起只是把高度裁到 0，不是不渲染。
    const body = byId(tree, 'pet-cfg-paths-meta');
    assert.ok(body);
    assert.equal(body.props['aria-hidden'], 'true');
    const card = byClass(tree, 'dsh-pet-cfg__card');
    assert.ok(String(card?.props.className).includes('is-fold'));
    assert.ok(!String(card?.props.className).includes('is-open'));
  });

  test('展开态：aria-expanded 为 true，去掉 aria-hidden 并挂上 is-open', () => {
    const tree = make(true).ConfigMetaCard({ paths: meta });
    const button = byClass(tree, 'dsh-pet-cfg__foldToggle');
    assert.equal(button?.props['aria-expanded'], true);
    assert.equal(byId(tree, 'pet-cfg-paths-meta')?.props['aria-hidden'], undefined);
    const card = byClass(tree, 'dsh-pet-cfg__card');
    assert.ok(String(card?.props.className).includes('is-open'));
  });

  test('点标题行回传取反后的状态', () => {
    const closed: boolean[] = [];
    const closedButton = byClass(make(false, closed).ConfigMetaCard({ paths: meta }), 'dsh-pet-cfg__foldToggle');
    (closedButton?.props.onClick as () => void)();
    assert.deepEqual(closed, [true]);

    const open: boolean[] = [];
    const openButton = byClass(make(true, open).ConfigMetaCard({ paths: meta }), 'dsh-pet-cfg__foldToggle');
    (openButton?.props.onClick as () => void)();
    assert.deepEqual(open, [false]);
  });

  test('点问号只拦冒泡、不切换开合', () => {
    const seen: boolean[] = [];
    const wrap = byClass(make(false, seen).ConfigMetaCard({ paths: meta }), 'dsh-pet-cfg__qWrap');
    assert.ok(wrap);
    let stopped = false;
    (wrap.props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: () => {
        stopped = true;
      },
    });
    assert.equal(stopped, true);
    assert.deepEqual(seen, []);
  });

  test('两张卡各用各的正文 id', () => {
    const cards = make(false);
    const metaTree = cards.ConfigMetaCard({ paths: meta });
    const storageTree = cards.StorageCard({ paths: meta });
    assert.equal(byClass(metaTree, 'dsh-pet-cfg__foldToggle')?.props['aria-controls'], 'pet-cfg-paths-meta');
    assert.equal(byClass(storageTree, 'dsh-pet-cfg__foldToggle')?.props['aria-controls'], 'pet-cfg-paths-storage');
  });
});

describe('paths-cards —— 内容不因折叠而变', () => {
  test('高级配置列出五条路径与日志说明', () => {
    const tree = make(false).ConfigMetaCard({ paths: meta });
    const rows = flatten(tree).filter((node) => String(node.props?.className ?? '').includes('dsh-pet-cfg__path'));
    assert.equal(rows.length, 5);
    assert.ok(flatten(tree).some((node) => node.props?.className === 'dsh-pet-cfg__note'));
  });

  test('卸载与存储：两条路径、卸载命令与三步说明', () => {
    const tree = make(false).StorageCard({ paths: meta });
    const rows = flatten(tree).filter((node) => String(node.props?.className ?? '').includes('dsh-pet-cfg__path'));
    assert.equal(rows.length, 2);
    assert.ok(flatten(tree).some((node) => node.props?.className === 'dsh-pet-cfg__cmd'));
    const notes = flatten(tree).filter((node) => node.props?.className === 'dsh-pet-cfg__note');
    assert.equal(notes.length, 3);
  });

  test('没有存储清单时整卡不渲染', () => {
    const tree = make(false).StorageCard({ paths: { ...meta, storage: [] } });
    assert.equal(tree, null);
  });
});
