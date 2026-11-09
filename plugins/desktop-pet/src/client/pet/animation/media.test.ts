/**
 * 素材格式探测（src/client/pet/animation/media.ts）的契约测试。
 *
 * 三条契约：
 *   1. Chromium 系（含 Electron）与 Firefox 一律要 webm——它们原生支持 VP9-alpha；
 *   2. 只有 macOS 的 WebKit 才要 mov（HEVC-alpha）：Safari 能解码 VP9 但会丢 alpha，表现成黑底；
 *   3. 扩展名按会话缓存一次：首帧定下之后不再跟着 UA 变。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { prefersMov, thumbExt } from './media.ts';
import { ANIMATION_EXT } from '../../../shared/constants.ts';

/** 装一套假 navigator，返回还原函数。 */
function withNavigator(userAgent: string, platform: string): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent, platform },
    configurable: true,
  });
  return () => {
    if (previous === undefined) delete (globalThis as { navigator?: unknown }).navigator;
    else Object.defineProperty(globalThis, 'navigator', previous);
  };
}

describe('prefersMov —— 是否需要 HEVC-alpha', () => {
  test('macOS 上的 Safari 要 mov', () => {
    const restore = withNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel');
    try {
      assert.equal(prefersMov(), true);
    } finally {
      restore();
    }
  });

  test('Chrome / Electron 在 macOS 上也不要 mov（原生 VP9-alpha）', () => {
    const restore = withNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'MacIntel',
    );
    try {
      assert.equal(prefersMov(), false);
    } finally {
      restore();
    }
  });

  test('Firefox 与 Edge 同样走 webm', () => {
    for (const ua of ['Mozilla/5.0 Firefox/121.0', 'Mozilla/5.0 Chrome/120 Edg/120.0']) {
      const restore = withNavigator(ua, 'Win32');
      try {
        assert.equal(prefersMov(), false, ua);
      } finally {
        restore();
      }
    }
  });

  test('非 Mac 平台的 WebKit（iOS 以外的未知 UA）不要 mov', () => {
    const restore = withNavigator('Mozilla/5.0 AppleWebKit/605.1.15', 'Win32');
    try {
      assert.equal(prefersMov(), false);
    } finally {
      restore();
    }
  });
});

describe('thumbExt —— 会话内固定的扩展名', () => {
  test('首次判定后沿用同一结果，不跟着 UA 变', () => {
    const restore = withNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'MacIntel',
    );
    try {
      const first = thumbExt();
      // ANIMATION_EXT 的静态类型被窄化为 '.webm'，用户仍可能把它改成 .mov：按 string 读再比较。
      const explicit: string = ANIMATION_EXT;
      const expected = explicit === '.mov' ? '.mov' : '.webm';
      assert.equal(first, expected, '显式常量优先，否则按渲染端判断');
      // 换一套「要 mov」的环境，缓存命中时不该改口。
      const restore2 = withNavigator('Mozilla/5.0 AppleWebKit/605.1.15', 'MacIntel');
      try {
        assert.equal(thumbExt(), first, '扩展名按会话缓存一次');
      } finally {
        restore2();
      }
    } finally {
      restore();
    }
  });
});
