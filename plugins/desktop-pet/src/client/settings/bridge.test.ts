/**
 * 容器与设置页共享桥（src/client/settings/bridge.ts）的契约测试。
 *
 * 两条契约：
 *   1. 缺省即安全：设置页可能在容器装配前就保存，`reload()` 必须是可调用的空函数，`current` 必须是空数组；
 *   2. 双方拿到的是同一个对象：容器替换 `reload` / 写入 `current` 后，设置页读到的必须是新值（单例，不是快照）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { petBridge } from './bridge.ts';
import type { Pet } from '../../shared/types.ts';

/** 每个用例都从缺省形状开始，并把桥还原，避免用例之间互相污染。 */
function withBridge(run: () => void): void {
  const saved = { current: petBridge.current, reload: petBridge.reload, template: petBridge.template };
  petBridge.current = [];
  petBridge.reload = () => {};
  petBridge.template = undefined;
  try {
    run();
  } finally {
    petBridge.current = saved.current;
    petBridge.reload = saved.reload;
    petBridge.template = saved.template;
  }
}

describe('petBridge —— 容器与设置页的共享桥', () => {
  test('缺省形状：空列表、未定义模板、可调用的空 reload', () => {
    withBridge(() => {
      assert.deepEqual(petBridge.current, []);
      assert.equal(petBridge.template, undefined);
      assert.doesNotThrow(() => petBridge.reload(), '容器未装配时保存设置不能炸');
      assert.doesNotThrow(() => petBridge.reload({ main: { pets: [] } }), '带货重载同样不能炸');
    });
  });

  test('共享同一对象：容器写入后设置页立刻读到新值', () => {
    withBridge(() => {
      const seen: Array<Record<string, Record<string, unknown>> | undefined> = [];
      petBridge.reload = (merged) => seen.push(merged);
      // 只关心 id：容器写入的宠物对象其余字段与本用例无关。
      const pet = { id: 'pet-1' } as unknown as Pet;
      petBridge.current = [pet];
      petBridge.template = pet;

      assert.equal(petBridge.current.length, 1);
      assert.equal(petBridge.template?.id, 'pet-1');
      petBridge.reload({ main: { pets: [] } });
      assert.deepEqual(seen, [{ main: { pets: [] } }], '设置页保存后必须把成品聚合交给容器');
    });
  });
});
