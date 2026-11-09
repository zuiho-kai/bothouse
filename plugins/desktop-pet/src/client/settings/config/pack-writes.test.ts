/**
 * 写回计划（diffPackWrites）的契约测试。
 *
 * 三条契约：
 *   1. 只把「真的改了」的种类层列入计划，没改的一个请求都不发；
 *   2. main 永不进计划——它连同全局字段每次保存都整包写 PUT /config；
 *   3. 计划里带的是该种类的**全部**实例，漏一只就等于把它删掉。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { diffPackWrites } from './pack-writes.ts';
import type { ConfigEntry } from './read.ts';
import type { Pet } from '../../../shared/types.ts';

/** 一只字段齐全的实例。 */
const pet = (id: string, over: Partial<Pet> = {}): Pet => ({
  id,
  name: id,
  size: 300,
  balanceEnabled: false,
  whisperEnabled: false,
  workStatusEnabled: false,
  fixedEnabled: false,
  display: 'web',
  position: { corner: 'top-right', marginX: 10, marginY: 10 },
  ...over,
});

/** 加载快照：main 一只 + glm 一只。 */
const loaded = (): ConfigEntry[] => [
  { key: 'main', kind: 'main', pets: [pet('m1', { assetRoot: 'main' })] },
  { key: 'glm', kind: 'pack', pets: [pet('g1', { assetRoot: 'glm' })] },
];

describe('diffPackWrites —— 编辑列表 → 要写回的种类层', () => {
  test('没有改动：计划为空，一个请求都不发', () => {
    const current = loaded().flatMap((entry) => entry.pets);
    assert.deepEqual(diffPackWrites(loaded(), current), []);
  });

  test('改了某个种类的一个字段：只列该种类', () => {
    const current = [pet('m1', { assetRoot: 'main' }), pet('g1', { assetRoot: 'glm', size: 360 })];
    const plan = diffPackWrites(loaded(), current);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].entry, 'glm');
    assert.equal(plan[0].pets[0].size, 360);
  });

  test('main 的改动不进计划（走 PUT /config）', () => {
    const current = [pet('m1', { assetRoot: 'main', size: 500 }), pet('g1', { assetRoot: 'glm' })];
    assert.deepEqual(diffPackWrites(loaded(), current), []);
  });

  test('新增一只：计划里带该种类的全部实例', () => {
    const current = [
      pet('m1', { assetRoot: 'main' }),
      pet('g1', { assetRoot: 'glm' }),
      pet('g2', { assetRoot: 'glm' }),
    ];
    const plan = diffPackWrites(loaded(), current);
    assert.deepEqual(
      plan[0].pets.map((item) => item.id),
      ['g1', 'g2'],
      '整段替换语义：漏传的实例会被删掉',
    );
  });

  test('只改 sizePercent 也算改动（指纹必须覆盖它，否则改百分比会静默不落盘）', () => {
    const current = [pet('m1', { assetRoot: 'main' }), pet('g1', { assetRoot: 'glm', sizePercent: 40 })];
    const plan = diffPackWrites(loaded(), current);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].pets[0].sizePercent, 40);
  });

  test('只是调换实例顺序也算改动', () => {
    const before = loaded();
    before[1].pets.push(pet('g2', { assetRoot: 'glm' }));
    const current = [
      pet('m1', { assetRoot: 'main' }),
      pet('g2', { assetRoot: 'glm' }),
      pet('g1', { assetRoot: 'glm' }),
    ];
    assert.equal(diffPackWrites(before, current).length, 1);
  });
});
