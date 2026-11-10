/**
 * 对话图片入参解析的单测：形状、媒体类型白名单、base64 规范化三条边界。
 *
 * 为什么单独钉 base64 规范化：Buffer 解码会静默丢弃非法字符，不比对重新编码的结果时，
 * `"abc!!!"` 会被解成另一串字节——调用方以为发了 A、模型看到的是 B，且全程没有报错。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseImageAttachment } from './image-attachment.ts';

/** 最小 PNG 头（8 字节签名）：足够验证往返一致，不需要真图片。 */
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 规范 base64 编码的 PNG 头 */
const PNG_BASE64 = PNG_HEAD.toString('base64');

describe('parseImageAttachment', () => {
  test('合法 PNG：字节与原图逐字节一致 → 通过', () => {
    const parsed = parseImageAttachment({ mediaType: 'image/png', data: PNG_BASE64 });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.mediaType, 'image/png');
    assert.deepEqual(parsed.bytes, new Uint8Array(PNG_HEAD));
  });

  test('白名单内的其它格式（JPEG/WebP/GIF）同样接受', () => {
    for (const mediaType of ['image/jpeg', 'image/webp', 'image/gif'] as const) {
      const parsed = parseImageAttachment({ mediaType, data: PNG_BASE64 });
      assert.equal(parsed.ok, true, mediaType);
    }
  });

  test('非对象 / null / 数组 → 拒绝', () => {
    for (const raw of [undefined, null, [], 'abc', 1, true]) {
      assert.equal(parseImageAttachment(raw).ok, false, JSON.stringify(raw));
    }
  });

  test('mediaType 缺失、不是字符串或不在白名单 → 拒绝', () => {
    for (const mediaType of [undefined, 1, 'image/bmp', 'IMAGE/PNG', '']) {
      const parsed = parseImageAttachment({ mediaType, data: PNG_BASE64 });
      assert.equal(parsed.ok, false, String(mediaType));
    }
  });

  test('data 缺失、为空或不是字符串 → 拒绝', () => {
    for (const data of [undefined, '', 123, null]) {
      const parsed = parseImageAttachment({ mediaType: 'image/png', data });
      assert.equal(parsed.ok, false, String(data));
    }
  });

  test('含非法字符的 base64 → 拒绝（不能被静默丢弃）', () => {
    const parsed = parseImageAttachment({ mediaType: 'image/png', data: PNG_BASE64 + '!!!' });
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? '' : parsed.message, /不是合法的 base64/);
  });

  test('缺填充（非规范 base64）→ 拒绝', () => {
    // 去掉尾部 '=' 后多数解码器仍能解出同一串字节，正因如此才必须比对重新编码结果
    const unpadded = PNG_BASE64.replace(/=+$/, '');
    assert.notEqual(unpadded, PNG_BASE64, '样例本身必须带填充，否则这条用例没有意义');
    assert.equal(parseImageAttachment({ mediaType: 'image/png', data: unpadded }).ok, false);
  });

  test('解码后为空串 → 拒绝', () => {
    assert.equal(parseImageAttachment({ mediaType: 'image/png', data: '====' }).ok, false);
  });

  test('超出字符上限 → 拒绝且提示压缩', () => {
    const parsed = parseImageAttachment({ mediaType: 'image/png', data: 'A'.repeat(900_001) });
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? '' : parsed.message, /过长/);
  });
});
