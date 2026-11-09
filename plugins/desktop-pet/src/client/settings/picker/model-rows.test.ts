/**
 * 模型选择器行模型的契约测试。
 *
 * 三条契约：
 *   1. 「跟随当前对话」不是模型：只在没有搜索词时出现；
 *   2. 搜索是大小写不敏感的有序子序列匹配，且命中不了的服务商整组不显示；
 *   3. 只有「无搜索词且该服务商确实没有模型」才补一行「没有可用模型」，其余情况不产生提示行。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildModelRows, matchModelQuery, selectableIndexes, type ModelCatalogGroup } from './model-rows.ts';

const catalog: ModelCatalogGroup[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'o3', name: 'o3' },
    ],
  },
  {
    id: 'empty',
    name: '无模型服务商',
    models: [],
  },
];

const kinds = (rows: ReturnType<typeof buildModelRows>): string[] => rows.map((row) => row.kind);

describe('matchModelQuery —— 搜索语义', () => {
  test('空搜索词命中一切；纯空白等同空', () => {
    assert.equal(matchModelQuery('GPT-4o', ''), true);
    assert.equal(matchModelQuery('GPT-4o', '   '), true);
  });

  test('大小写不敏感的有序子序列：gpt4 命中 GPT-4o', () => {
    assert.equal(matchModelQuery('GPT-4o', 'gpt4'), true);
    assert.equal(matchModelQuery('GPT-4o', 'GpT4O'), true);
  });

  test('字符顺序不对或字符不全就不命中', () => {
    assert.equal(matchModelQuery('GPT-4o', '4gpt'), false, '子序列必须保持原顺序');
    assert.equal(matchModelQuery('GPT-4o', 'gpt5'), false);
    assert.equal(matchModelQuery('GPT-4o', 'gpt4oo'), false, '重复字符不能凭空命中');
  });
});

describe('buildModelRows —— 行清单', () => {
  test('无搜索词：先「跟随当前对话」，再每个服务商一个分组头 + 组内全部模型', () => {
    const rows = buildModelRows(catalog, '');
    assert.deepEqual(kinds(rows), ['follow', 'group', 'model', 'model', 'group', 'none']);
    assert.equal(rows[1].kind === 'group' ? rows[1].name : '', 'OpenAI');
  });

  test('有搜索词：不出现「跟随当前对话」（它不是模型）', () => {
    const rows = buildModelRows(catalog, 'gpt');
    assert.equal(
      rows.some((row) => row.kind === 'follow'),
      false,
    );
  });

  test('有搜索词：组内一个都没命中就整组消失，连分组头也不留', () => {
    const rows = buildModelRows(catalog, 'gpt');
    assert.deepEqual(kinds(rows), ['group', 'model']);
    assert.equal(rows[0].key, 'openai', '剩下的分组头必须是命中的那个服务商');
  });

  test('空服务商：无搜索词时留分组头 + 一行「没有可用模型」，有搜索词时整组消失', () => {
    const idle = buildModelRows(catalog, '');
    assert.deepEqual(kinds(idle).slice(-2), ['group', 'none']);
    const searching = buildModelRows(catalog, 'zzz');
    assert.deepEqual(kinds(searching), []);
  });

  test('行的 key 唯一：同名模型在不同服务商下不会撞键', () => {
    const rows = buildModelRows(
      [
        { id: 'a', name: 'A', models: [{ id: 'same', name: '同名' }] },
        { id: 'b', name: 'B', models: [{ id: 'same', name: '同名' }] },
      ],
      '',
    );
    const keys = rows.map((row) => row.key);
    assert.equal(new Set(keys).size, keys.length, 'key 撞了会让 React 复用错节点');
  });
});

describe('selectableIndexes —— 键盘可走的位置', () => {
  test('跳过分组头与提示行，只留模型与「跟随当前对话」', () => {
    const rows = buildModelRows(catalog, '');
    const selectable = selectableIndexes(rows);
    assert.deepEqual(
      selectable.map((index) => rows[index].kind),
      ['follow', 'model', 'model'],
    );
  });

  test('没有可选行时返回空数组（键盘走动必须直接返回）', () => {
    assert.deepEqual(selectableIndexes(buildModelRows([], '')), [0], '空清单时仍有「跟随当前对话」');
    assert.deepEqual(selectableIndexes(buildModelRows(catalog, 'zzz')), []);
  });
});
