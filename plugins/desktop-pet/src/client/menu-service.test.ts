/**
 * 菜单镜像的行为契约：与 /menu/events 同形、读取即消费、按 owner 隔离、闩锁跟随项存活。
 *
 * 这里不测渲染与上报——上报点在 pet/menu-actions，快照同步点在 pet/multi。
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetMenuEvents, setMenuClick, setMenuItems, takeMenuEvents } from './menu-service.ts';

describe('menu-service —— 页面内的菜单镜像', () => {
  beforeEach(() => {
    resetMenuEvents();
  });

  test('还没同步到快照：任何 owner 都是未知', () => {
    assert.deepEqual(takeMenuEvents('baifan'), { ok: false, reason: 'unknown-owner' });
  });

  test('刚注册还没人点：全量映射里每项都是 null', () => {
    setMenuItems([
      { label: '喂鱼', owner: 'baifan' },
      { label: '摸头', owner: 'baifan' },
    ]);
    assert.deepEqual(takeMenuEvents('baifan'), { events: { 喂鱼: null, 摸头: null }, ok: true });
  });

  test('读取即消费：读完清回 null，再读一次不会重复拿到', () => {
    setMenuItems([{ label: '喂鱼', owner: 'baifan' }]);
    setMenuClick('baifan', '喂鱼', 'main');
    assert.deepEqual(takeMenuEvents('baifan'), { events: { 喂鱼: 'main' }, ok: true });
    assert.deepEqual(takeMenuEvents('baifan'), { events: { 喂鱼: null }, ok: true });
  });

  test('按 owner 隔离：一个 owner 的点击不会被另一个 owner 读走', () => {
    setMenuItems([
      { label: 'x', owner: 'a' },
      { label: 'y', owner: 'b' },
    ]);
    setMenuClick('a', 'x', 'main');
    assert.deepEqual(takeMenuEvents('b'), { events: { y: null }, ok: true });
    assert.deepEqual(takeMenuEvents('a'), { events: { x: 'main' }, ok: true });
  });

  test('先点击后同步快照：这一下不会丢', () => {
    setMenuClick('baifan', '喂鱼', 'main');
    setMenuItems([{ label: '喂鱼', owner: 'baifan' }]);
    assert.deepEqual(takeMenuEvents('baifan'), { events: { 喂鱼: 'main' }, ok: true });
  });

  test('项下线后不再可读：owner 重注册也不会读到上一次的残留', () => {
    setMenuItems([{ label: '喂鱼', owner: 'baifan' }]);
    setMenuClick('baifan', '喂鱼', 'main');
    setMenuItems([{ label: '摸头', owner: 'baifan' }]);
    assert.deepEqual(takeMenuEvents('baifan'), { events: { 摸头: null }, ok: true });
  });
});
