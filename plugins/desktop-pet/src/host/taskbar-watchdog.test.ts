/**
 * 桌面 helper「任务栏看门狗」的判定。
 *
 * Windows 上 `skipTaskbar` 只是一次 `ITaskbarList::DeleteTab`，不写 `WS_EX_TOOLWINDOW`；explorer 崩溃重启
 * 或唤醒后 shell 重建任务栏，按钮会重新登记，且时机不可枚举——只能低频重申。本文件钉判定规则：
 * 仅 Windows 且总开关开启时才轮询；环境变量只有显式 `0` / `false` 才关闭。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const helper = '../../runtime/electron-helper/';
const {
  TASKBAR_WATCHDOG_ENABLED,
  TASKBAR_WATCHDOG_TICK_MS,
  shouldRunTaskbarWatchdog,
  taskbarWatchdogEnabledFromEnv,
} = require(helper + 'taskbar-watchdog.js');

describe('shouldRunTaskbarWatchdog —— 只在 Windows 且开启时轮询', () => {
  test('Windows + 开启：轮询', () => {
    assert.equal(shouldRunTaskbarWatchdog('win32', true), true);
  });

  test('Windows + 关闭：一次都不摘', () => {
    assert.equal(shouldRunTaskbarWatchdog('win32', false), false, '总开关关闭时必须完全退回事件驱动');
  });

  test('macOS / Linux：不轮询', () => {
    assert.equal(shouldRunTaskbarWatchdog('darwin', true), false, 'macOS 没有任务栏');
    assert.equal(shouldRunTaskbarWatchdog('linux', true), false, 'Linux 的 skipTaskbar 依赖 WM，行为不同');
  });

  test('缺省取编译期默认开关', () => {
    assert.equal(shouldRunTaskbarWatchdog('win32'), TASKBAR_WATCHDOG_ENABLED);
  });
});

describe('taskbarWatchdogEnabledFromEnv —— 只有显式 0/false 才关闭', () => {
  test('未设置：开启', () => {
    assert.equal(taskbarWatchdogEnabledFromEnv(undefined), true, '缺失时保持开启，不能因为环境变量没配就不摘');
  });

  test("显式 '0' / 'false'：关闭", () => {
    assert.equal(taskbarWatchdogEnabledFromEnv('0'), false);
    assert.equal(taskbarWatchdogEnabledFromEnv('false'), false);
  });

  test("'1' / 'true' / 其它：开启", () => {
    assert.equal(taskbarWatchdogEnabledFromEnv('1'), true);
    assert.equal(taskbarWatchdogEnabledFromEnv('true'), true);
    assert.equal(taskbarWatchdogEnabledFromEnv('yes'), true, '写坏的值不能意外关掉看门狗');
  });
});

test('节拍：整数毫秒，且落在一个合理区间', () => {
  assert.ok(Number.isInteger(TASKBAR_WATCHDOG_TICK_MS), '节拍必须是整数毫秒');
  assert.ok(
    TASKBAR_WATCHDOG_TICK_MS > 0 && TASKBAR_WATCHDOG_TICK_MS <= 10000,
    '节拍应在 0–10s 之间：太短浪费 COM 调用，太长按钮可见过久',
  );
});
