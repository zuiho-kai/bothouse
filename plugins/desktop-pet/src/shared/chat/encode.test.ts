/**
 * 图片预算换算的单测：字节反推、长边缩放与质量阶梯。
 *
 * 为什么值得钉：这三个数字决定"截图能不能发出去"。换算写错不会报错，
 * 只会表现为宿主回 413 或图片被压成马赛克。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, IMAGE_QUALITIES, attachmentBytes, targetSize } from './encode.ts';

describe('attachmentBytes', () => {
  test('与 Buffer 的 base64 换算一致（含填充边界）', () => {
    for (const n of [1, 2, 3, 4, 1000]) {
      const base64 = Buffer.alloc(n, 7).toString('base64');
      assert.equal(attachmentBytes(base64), n, String(n));
    }
  });
});

describe('targetSize', () => {
  test('长边超限时等比缩到上限', () => {
    assert.deepEqual(targetSize(4000, 3000), { width: 2048, height: 1536 });
  });

  test('不超过上限就不放大', () => {
    assert.deepEqual(targetSize(800, 600), { width: 800, height: 600 });
  });

  test('极端长条图至少留 1px', () => {
    const size = targetSize(1, 4000);
    assert.equal(size.height, IMAGE_MAX_SIDE);
    assert.equal(size.width, 1);
  });
});

describe('预算不变量', () => {
  test('质量阶梯从高到低且不重复', () => {
    for (let i = 1; i < IMAGE_QUALITIES.length; i += 1) {
      assert.ok(IMAGE_QUALITIES[i] < IMAGE_QUALITIES[i - 1], `第 ${i} 档应更低`);
    }
  });

  test('640 KiB 换成 base64 后仍在宿主 900000 字符上限内', () => {
    // 宿主侧 MAX_BASE64_CHARS = 900_000，这里用 4/3 膨胀后比较，留出 JSON 结构余量
    const base64Chars = Math.ceil(IMAGE_MAX_BYTES / 3) * 4;
    assert.ok(base64Chars < 900_000, String(base64Chars));
  });
});
