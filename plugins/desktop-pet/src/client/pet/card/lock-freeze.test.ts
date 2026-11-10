/**
 * 占用锁冻结驱动的纯函数契约（src/client/pet/card/lock-freeze.ts）：lock 叶子 → 冻结截止时刻。
 *
 * 定时器的挂载与清理需要真实渲染，由手动验收覆盖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { freezeDeadline } from './lock-freeze.ts';

const NOW_MS = 1_700_000_000_000;

describe('freezeDeadline —— 叶子换算出冻结截止时刻', () => {
  test('没有叶子：不冻结', () => {
    assert.equal(freezeDeadline(undefined, NOW_MS), 0);
  });

  test('叶子标记未占用：即使带旧的 expiresAt 也不冻结', () => {
    assert.equal(freezeDeadline({ locked: false }, NOW_MS), 0);
  });

  test('占用且未到期：返回到期时刻', () => {
    assert.equal(freezeDeadline({ locked: true, expiresAt: NOW_MS + 5_000 }, NOW_MS), NOW_MS + 5_000);
  });

  test('占用但已过期：当作没有锁（刷新后拿到陈旧叶子）', () => {
    assert.equal(freezeDeadline({ locked: true, expiresAt: NOW_MS - 1 }, NOW_MS), 0);
  });

  test('恰好到期这一刻：不冻结，不留零时长定时器', () => {
    assert.equal(freezeDeadline({ locked: true, expiresAt: NOW_MS }, NOW_MS), 0);
  });
});
