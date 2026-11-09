/**
 * 触屏长按（src/client/pet/motion/touch-press.ts）的契约测试：到点触发一次，
 * 计时期间移动超容差或松手都取消，鼠标与笔不起表。
 * 用 node 的假计时器驱动，回调参数按现场对象断言。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createTouchPress, type TouchPressTarget } from './touch-press.ts';

/** 假元素：只留释放捕获与派发。 */
function fakeEl() {
  const released: number[] = [];
  const dispatched: string[] = [];
  return {
    el: {
      hasPointerCapture: () => true,
      releasePointerCapture: (id: number) => released.push(id),
      dispatchEvent: (event: Event) => dispatched.push(event.type),
    } as unknown as HTMLElement,
    released,
    dispatched,
  };
}

/** 造一次按下的现场。 */
function target(pointerType = 'touch'): { value: TouchPressTarget; fake: ReturnType<typeof fakeEl> } {
  const fake = fakeEl();
  return { fake, value: { el: fake.el, pointerId: 7, pointerType, x: 120, y: 240 } };
}

describe('createTouchPress —— 到点触发', () => {
  test('触屏按满时长：回调一次，带上按下的现场', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => true, onMenu: (value) => seen.push(value) });
    const { value } = target();
    press.arm(value);
    assert.equal(press.isArmed(), true);
    t.mock.timers.tick(499);
    assert.equal(seen.length, 0, '未满时长不应触发');
    t.mock.timers.tick(1);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], value);
    assert.equal(press.isArmed(), false);
  });

  test('鼠标与笔：不起表', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => true, onMenu: (value) => seen.push(value) });
    press.arm(target('mouse').value);
    press.arm(target('pen').value);
    assert.equal(press.isArmed(), false);
    t.mock.timers.tick(1000);
    assert.equal(seen.length, 0);
  });

  test('到点时按压已结束：回调自弃', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let holding = true;
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => holding, onMenu: (value) => seen.push(value) });
    press.arm(target().value);
    holding = false;
    t.mock.timers.tick(500);
    assert.equal(seen.length, 0);
  });

  test('重复起表：只保留最后一次，到点只触发一次', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => true, onMenu: (value) => seen.push(value) });
    press.arm(target().value);
    t.mock.timers.tick(200);
    press.arm(target().value);
    t.mock.timers.tick(500);
    assert.equal(seen.length, 1);
  });
});

describe('createTouchPress —— 取消', () => {
  test('移动超过容差：取消，到点不触发', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => true, onMenu: (value) => seen.push(value) });
    press.arm(target().value);
    press.move(8);
    assert.equal(press.isArmed(), true, '正好等于容差时还不取消');
    press.move(9);
    assert.equal(press.isArmed(), false);
    t.mock.timers.tick(500);
    assert.equal(seen.length, 0);
  });

  test('松手取消：到点不触发', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const seen: TouchPressTarget[] = [];
    const press = createTouchPress({ stillHolding: () => true, onMenu: (value) => seen.push(value) });
    press.arm(target().value);
    press.cancel();
    assert.equal(press.isArmed(), false);
    t.mock.timers.tick(500);
    assert.equal(seen.length, 0);
  });

  test('没起表时移动与取消都是空操作', () => {
    const press = createTouchPress({ stillHolding: () => true, onMenu: () => {} });
    press.move(100);
    press.cancel();
    assert.equal(press.isArmed(), false);
  });
});
