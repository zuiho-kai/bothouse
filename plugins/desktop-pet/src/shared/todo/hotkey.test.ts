/**
 * 待办面板的悬停快捷键（src/shared/todo/hotkey.ts）：只认裸按的 D。
 *
 * 按键的通用规则由 shared/hotkey 的测试钉住，这里只验「哪个键」这一条。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TODO_HOTKEY_HINT, isTodoHotkey } from './hotkey.ts';
import type { HotkeyEvent } from '../hotkey.ts';

/** 一个最小的键盘事件替身。 */
function ev(over: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return { key: 'd', ctrlKey: false, metaKey: false, altKey: false, target: null, ...over };
}

describe('isTodoHotkey —— 裸按 D 才开关面板', () => {
  test('d 与 D 都算', () => {
    assert.equal(isTodoHotkey(ev({ key: 'd' })), true);
    assert.equal(isTodoHotkey(ev({ key: 'D' })), true);
  });

  test('对话的 T 不算', () => {
    assert.equal(isTodoHotkey(ev({ key: 't' })), false);
  });

  test('带修饰键不算', () => {
    assert.equal(isTodoHotkey(ev({ ctrlKey: true })), false);
    assert.equal(isTodoHotkey(ev({ altKey: true })), false);
  });

  test('在输入框里打字不算', () => {
    const input = { tagName: 'INPUT' } as unknown as EventTarget;
    assert.equal(isTodoHotkey(ev({ target: input })), false);
  });

  test('菜单提示与按键说的是同一个键', () => {
    assert.ok(TODO_HOTKEY_HINT.startsWith('D'), `提示应写明 D，实得 ${TODO_HOTKEY_HINT}`);
  });
});
