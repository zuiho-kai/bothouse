/**
 * 悬停快捷键的通用判据（src/shared/hotkey.ts）：裸按某键、且不抢输入框里的打字。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isBareKey, isTypingTarget, type HotkeyEvent } from './hotkey.ts';

/** 一个最小的键盘事件替身：判据只读 key、修饰键与 target。 */
function ev(over: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return { key: 'd', ctrlKey: false, metaKey: false, altKey: false, target: null, ...over };
}

/** 造一个只带 tagName 的假元素。 */
function tag(name: string): EventTarget {
  return { tagName: name } as unknown as EventTarget;
}

describe('isBareKey —— 只认没有修饰键的单键', () => {
  test('大小写都算：d 与 D 都匹配小写 d', () => {
    assert.equal(isBareKey(ev({ key: 'd' }), 'd'), true, '小写应匹配');
    assert.equal(isBareKey(ev({ key: 'D' }), 'd'), true, '大写应匹配');
  });

  test('别的键不算', () => {
    assert.equal(isBareKey(ev({ key: 't' }), 'd'), false);
    assert.equal(isBareKey(ev({ key: 'ArrowDown' }), 'd'), false);
  });

  test('带 Ctrl / Meta / Alt 一律不算：那是浏览器或宿主的快捷键', () => {
    assert.equal(isBareKey(ev({ ctrlKey: true }), 'd'), false);
    assert.equal(isBareKey(ev({ metaKey: true }), 'd'), false);
    assert.equal(isBareKey(ev({ altKey: true }), 'd'), false);
  });

  test('焦点在输入框里不算：那是打字', () => {
    assert.equal(isBareKey(ev({ target: tag('INPUT') }), 'd'), false);
    assert.equal(isBareKey(ev({ target: tag('TEXTAREA') }), 'd'), false);
    assert.equal(isBareKey(ev({ target: tag('SELECT') }), 'd'), false);
  });

  test('焦点在普通元素上算', () => {
    assert.equal(isBareKey(ev({ target: tag('DIV') }), 'd'), true);
    assert.equal(isBareKey(ev(), 'd'), true, 'target 为 null 也应算');
  });
});

describe('isTypingTarget —— 这些地方按键属于打字', () => {
  test('输入类元素与 contenteditable', () => {
    assert.equal(isTypingTarget(tag('INPUT')), true);
    assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  });

  test('普通元素与空目标', () => {
    assert.equal(isTypingTarget(tag('DIV')), false);
    assert.equal(isTypingTarget(null), false);
  });
});
