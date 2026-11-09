/**
 * 设置页共用小件（src/client/settings/ui.ts）的契约测试。
 *
 * 三条契约：
 *   1. 说明一律走 `data-tip` 气泡属性，且带说明的字段必须同时有可读的 `aria-label`；
 *   2. 开关格的勾选态与禁用态透传给原生 checkbox，切换只回传布尔值；
 *   3. 没有说明时不留空的问号，也不给无说明的元素加 `data-tip`。
 *
 * 用假的 `h` 记录节点树（不引 jsdom）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeUiKit } from './ui.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: string, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

const ui = makeUiKit({ h, t: (key) => key });

/** 摊平整棵树，便于按标签找节点。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const byClass = (node: unknown, className: string): Node[] =>
  flatten(node).filter((child) => String(child.props.className ?? '').includes(className));

describe('field —— 字段', () => {
  test('带说明：标签后面跟一个问号，说明同时写进 data-tip 与 aria-label', () => {
    const field = ui.field('大小', h('input', {}), '高度自动 = 宽度 × 9/16');
    const [label] = byClass(field, 'dsh-pet-cfg__flabel');
    const question = byClass(label, 'dsh-pet-cfg__q')[0];
    assert.equal(question.props['aria-label'], '高度自动 = 宽度 × 9/16', '问号必须有无障碍名');
    assert.equal(question.props['data-tip'], '高度自动 = 宽度 × 9/16');
    assert.equal(question.props.role, 'img');
    assert.equal(
      flatten(label).some((node) => node.tag === 'input'),
      false,
      '输入框在字段容器里，不在标签里',
    );
  });

  test('不带说明：标签就是纯文本，不凭空长出一个问号', () => {
    const field = ui.field('大小', h('input', {}));
    assert.deepEqual(byClass(field, 'dsh-pet-cfg__q'), []);
    const [label] = byClass(field, 'dsh-pet-cfg__flabel');
    assert.equal(label.props.children, '大小');
  });

  test('问号不挂 data-tip-end：气泡靠 tip-layer 自动翻边，不再分左右', () => {
    const field = ui.field('大小', h('input', {}), '说明');
    const [question] = byClass(field, 'dsh-pet-cfg__q');
    assert.equal(question.props['data-tip-end'], undefined);
  });
});

describe('toggleCell —— 开关格', () => {
  test('勾选态与禁用态透传给 checkbox，标题走翻译', () => {
    const cell = ui.toggleCell('notifyToggle', true, true, () => {});
    const input = flatten(cell).find((node) => node.tag === 'input');
    assert.equal(input?.props.type, 'checkbox');
    assert.equal(input?.props.checked, true);
    assert.equal(input?.props.disabled, true);
    assert.ok(flatten(cell).some((node) => node.props.children === 'notifyToggle'));
  });

  test('切换只回传布尔值，不把事件对象抛给调用方', () => {
    const seen: boolean[] = [];
    const cell = ui.toggleCell('x', false, false, (value) => seen.push(value));
    const input = flatten(cell).find((node) => node.tag === 'input');
    const onChange = input?.props.onChange as (event: { target: { checked: boolean } }) => void;
    onChange({ target: { checked: true } });
    assert.deepEqual(seen, [true]);
  });

  test('说明固定在 `<label + Hint>` 上', () => {
    const cell = ui.toggleCell('notifyToggle', false, false, () => {});
    const [question] = byClass(cell, 'dsh-pet-cfg__q');
    assert.equal(question.props['aria-label'], 'notifyToggleHint');
    assert.equal(question.props['data-tip'], 'notifyToggleHint');
  });
});

describe('cardHead —— 卡片头', () => {
  test('标题 + 问号；没有说明时只有标题', () => {
    const withHint = ui.cardHead('宠物配置', '每只宠物独立配置');
    const [question] = byClass(withHint, 'dsh-pet-cfg__q');
    assert.equal(question.props['aria-label'], '每只宠物独立配置');

    const without = ui.cardHead('宠物配置');
    assert.deepEqual(byClass(without, 'dsh-pet-cfg__q'), []);
  });
});
