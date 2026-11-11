/**
 * 睡觉状态与挑选逻辑单测：钉住「进睡写定三段名字、重复进睡不重放、醒来只清状态」与
 * 「整套随机 + 段内随机、没有可用套时返回 null」。
 *
 * 纯逻辑，不启 HTTP、不碰文件；叶子同步用回调收集。
 * 跑法：node --experimental-strip-types --test src/host/sleep.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SleepStore, pickSleepNames, pickSleepText, sleepTextsOf, type SleepLeafData } from './sleep.ts';

describe('SleepStore —— 进睡 / 醒来 / 叶子同步', () => {
  test('进睡写定三段名字并同步叶子；再次进睡保持原套、不重复写叶子', () => {
    const writes: Array<[string, SleepLeafData]> = [];
    const store = new SleepStore({ onChange: (petId, data) => writes.push([petId, data]) });
    const first = { start: '睡-开始', loop: '睡-循环', end: '睡-起来' };
    const second = { start: '趴-开始', loop: '趴-循环', end: '趴-起来' };

    assert.equal(store.enter('a', first), true);
    assert.deepEqual(store.setOf('a'), first);
    assert.equal(store.enter('a', second), false, '已经在睡时保持原套');
    assert.deepEqual(store.setOf('a'), first);
    assert.equal(writes.length, 1, '重复进睡不得再写一次叶子');
    assert.deepEqual(writes[0], ['a', { sleeping: true, ...first }]);
  });

  test('醒来清状态并写 sleeping:false；没在睡时是幂等空操作', () => {
    const writes: Array<[string, SleepLeafData]> = [];
    const store = new SleepStore({ onChange: (petId, data) => writes.push([petId, data]) });
    store.enter('a', { start: 'a1', loop: 'a2', end: 'a3' });

    assert.equal(store.wake('a'), true);
    assert.equal(store.sleeping('a'), false);
    assert.deepEqual(writes[writes.length - 1], ['a', { sleeping: false }]);
    assert.equal(store.wake('a'), false);
    assert.equal(writes.length, 2);
  });

  test('anySleeping / ids 反映当前睡着的宠物；wakeAll 一次清空', () => {
    const store = new SleepStore();
    assert.equal(store.anySleeping(), false);
    store.enter('a', { start: 'a1', loop: 'a2', end: 'a3' });
    store.enter('b', { start: 'b1', loop: 'b2', end: 'b3' });
    assert.equal(store.anySleeping(), true);
    assert.deepEqual(store.ids().sort(), ['a', 'b']);
    store.wakeAll();
    assert.equal(store.anySleeping(), false);
    assert.deepEqual(store.ids(), []);
  });
});

describe('pickSleepNames —— 整套随机 + 段内随机', () => {
  const animations = {
    sleep: [
      { start: ['蹲-开始'], loop: ['蹲-循环'], end: ['蹲-起来'] },
      { start: ['趴-开始'], loop: ['趴-循环'], end: ['趴-起来'] },
    ],
  };

  test('抽到的是同一套的三段（不会跨套拼）', () => {
    // roll 依次决定：段内索引 → 段内索引 → 段内索引 → 套索引（实现顺序），全部取 0 时落到第一套
    assert.deepEqual(
      pickSleepNames(animations, () => 0),
      { start: '蹲-开始', loop: '蹲-循环', end: '蹲-起来' },
    );
    assert.deepEqual(
      pickSleepNames(animations, () => 0.99),
      { start: '趴-开始', loop: '趴-循环', end: '趴-起来' },
    );
  });

  test('段内多候选时可各自命中不同项', () => {
    const multi = { sleep: [{ start: ['A1', 'A2'], loop: ['L1', 'L2'], end: ['E1', 'E2'] }] };
    const rolls = [0.9, 0.1, 0.9];
    let index = 0;
    const picked = pickSleepNames(multi, () => rolls[index++] ?? 0);
    assert.deepEqual(picked, { start: 'A2', loop: 'L1', end: 'E2' });
  });

  test('没有配置 / 空数组 / 空段时返回 null（调用方据此拒绝入睡）', () => {
    assert.equal(pickSleepNames(undefined), null);
    assert.equal(pickSleepNames({}), null);
    assert.equal(pickSleepNames({ sleep: [] }), null);
    assert.equal(pickSleepNames({ sleep: [{ start: [], loop: ['L'], end: ['E'] }] }), null);
    assert.equal(pickSleepNames({ sleep: [{ start: ['S'], loop: ['L'] }] }), null);
  });
});

describe('文本池 —— 台词只来自配置，代码不留第二份', () => {
  test('pickSleepText：池非空时随机挑一句；空池返回 undefined（调用方不弹气泡）', () => {
    const saved = Math.random;
    try {
      Math.random = () => 0.99;
      assert.equal(pickSleepText(['A', 'B']), 'B');
      assert.equal(pickSleepText([]), undefined);
    } finally {
      Math.random = saved;
    }
  });

  test('sleepTextsOf：三组台词都从条目配置读，缺字段即空（不落代码默认）', () => {
    const conf = {
      sleepStartTexts: ['去睡了'],
      sleepEndTexts: ['醒了'],
      sleepRefuseTexts: ['别吵'],
    };
    assert.deepEqual(sleepTextsOf(conf), {
      start: ['去睡了'],
      end: ['醒了'],
      refuse: ['别吵'],
    });
    assert.deepEqual(sleepTextsOf({}), { start: [], end: [], refuse: [] });
  });
});
