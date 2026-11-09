/**
 * 模型选择器浮层的契约测试。
 *
 * 三条契约：
 *   1. 三态分明：清单没拉到显示「加载中」/「拉取失败」，清单为空或搜索没命中显示对应空态，绝不静默留白；
 *   2. 选中态来自当前值：`aria-checked` 只落在真正选中的那一行上，高亮行另有 `is-active` 类；
 *   3. 禁用透传：选择器禁用时搜索框与每一行都不可点。
 *
 * 用假的 `h` 记录节点树（不引 jsdom，也不渲染真实 DOM）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { buildModelRows } from './model-rows.ts';
import { buildModelPanel, type ModelPanelView } from './model-picker-panel.ts';

/** 假节点：只留标签名与 props，够断言用。 */
interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: string, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/** 把整棵树摊平成节点数组，便于按标签或类名找。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  const children = element.props?.children;
  return [element, ...flatten(children)];
}

const catalog = [{ id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4o', name: 'GPT-4o' }] }];

/** 造一份视图；只覆盖用例关心的字段。 */
function view(overrides: Partial<ModelPanelView> = {}): ModelPanelView {
  const base: ModelPanelView = {
    h,
    // 翻译函数直接回键名，断言里就能按 key 定位文案，不依赖具体中英文。
    t: (key) => key,
    label: '碎碎念模型',
    disabled: false,
    catalog,
    failed: false,
    rows: buildModelRows(catalog, ''),
    active: 0,
    query: '',
    value: { provider: '', model: '' },
    pos: { left: 10, top: 20, width: 240, maxHeight: 300 },
    panelRef: { current: null },
    onQueryChange: () => {},
    onPick: () => {},
    onHover: () => {},
    onKeyDown: () => {},
  };
  return { ...base, ...overrides };
}

const texts = (tree: unknown): string[] =>
  flatten(tree)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string');

describe('buildModelPanel —— 浮层三态与选中态', () => {
  test('清单没拉到：显示「加载中」，不渲染行清单', () => {
    const tree = buildModelPanel(view({ catalog: null, rows: [] }));
    assert.deepEqual(
      flatten(tree)
        .filter((node) => node.tag === 'button')
        .map((node) => node.props.className),
      [],
      '还没拉到清单时不能出现可选行',
    );
    assert.deepEqual(texts(tree), ['modelLoading']);
  });

  test('拉取失败：显示「拉取失败」而不是「加载中」', () => {
    const tree = buildModelPanel(view({ catalog: null, rows: [], failed: true }));
    assert.deepEqual(texts(tree), ['modelCatalogFailed']);
  });

  test('宿主没有可用服务商：整块显示「没有可用模型」，不留空白浮层', () => {
    const tree = buildModelPanel(view({ catalog: [], rows: buildModelRows([], '') }));
    assert.deepEqual(
      texts(tree).filter((text) => text !== 'modelSearch'),
      ['modelNoModels'],
    );
  });

  test('搜索没命中：显示「没有匹配的模型」空态', () => {
    const tree = buildModelPanel(view({ query: 'zzz', rows: buildModelRows(catalog, 'zzz') }));
    assert.deepEqual(
      texts(tree).filter((text) => text !== 'modelSearch'),
      ['modelEmpty'],
    );
  });

  test('正常清单：行数、可点的行、选中态与高亮都跟着视图数据', () => {
    const rows = buildModelRows(catalog, '');
    // 行序：[跟随(0), 分组头(1), 模型(2)]，高亮落在模型那一行。
    const tree = buildModelPanel(view({ rows, active: 2, value: { provider: 'openai', model: 'gpt-4o' } }));
    const buttons = flatten(tree).filter((node) => node.tag === 'button');
    assert.equal(buttons.length, 2, '「跟随当前对话」+ 一个模型');
    const [follow, model] = buttons;
    assert.equal(follow.props['aria-checked'], false, '当前选的是具体模型，跟随行不该打勾');
    assert.equal(model.props['aria-checked'], true);
    assert.equal(model.props.className, 'dsh-pet-mp__item is-active', '高亮落在 active 行上');
    assert.equal(model.props['data-row'], 2);
  });

  test('禁用透传：搜索框与每一行都被禁用', () => {
    const tree = buildModelPanel(view({ disabled: true }));
    const nodes = flatten(tree);
    assert.equal(nodes.find((node) => node.tag === 'input')?.props.disabled, true);
    for (const button of nodes.filter((node) => node.tag === 'button')) {
      assert.equal(button.props.disabled, true);
    }
  });

  test('写入工序：面板带 menu 语义，搜索框带 aria-label', () => {
    const tree = buildModelPanel(view());
    const nodes = flatten(tree);
    const panel = nodes[0];
    assert.equal(panel.props.role, 'menu');
    assert.equal(panel.props['aria-label'], '碎碎念模型');
    const input = nodes.find((node) => node.tag === 'input');
    assert.equal(input?.props['aria-label'], 'modelSearch');
    assert.equal(input?.props.placeholder, 'modelSearch');
  });
});
