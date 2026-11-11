/**
 * 图片挑选判定的单测：MIME 白名单、扩展名兜底与剪贴板取图。
 *
 * 为什么值得钉：上传入口同时受 `<input accept>`（挑文件时过滤）与运行时判定（拖拽、粘贴不经过 accept），
 * 后者写错只会表现为"拖进来/粘上去没反应"，没有任何报错。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { firstImageFromClipboard, isImageFile } from './image-pick.ts';

/** 只造判定用到的两个字段：实现不读 File 的其它成员。 */
const file = (type: string, name: string): File => ({ type, name }) as File;

describe('isImageFile', () => {
  test('白名单 MIME 直接通过', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      assert.equal(isImageFile(file(mime, 'x')), true, mime);
    }
  });

  test('没有 MIME 时按扩展名兜底（拖拽/粘贴常见）', () => {
    for (const name of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.gif']) {
      assert.equal(isImageFile(file('', name)), true, name);
    }
  });

  test('扩展名大小写不敏感', () => {
    assert.equal(isImageFile(file('', 'Shot.PNG')), true);
  });

  test('非图片一律拒绝', () => {
    for (const [type, name] of [
      ['video/mp4', 'a.mp4'],
      ['text/plain', 'a.txt'],
      ['', 'README'],
      ['', 'a.png.exe'],
    ]) {
      assert.equal(isImageFile(file(type, name)), false, name);
    }
  });

  test('声明类型与扩展名冲突时，以白名单 MIME 为准', () => {
    // 用户把 .png 改名成 .txt，但系统仍报 image/png：这是图片，允许
    assert.equal(isImageFile(file('image/png', 'a.txt')), true);
  });
});

/** 造一个剪贴板条目；`getAsFile` 返回空表示非文件项。 */
const item = (f: File | null, kind = 'file') => ({ kind, getAsFile: () => f });

describe('firstImageFromClipboard', () => {
  test('files 里有图 → 直接取它', () => {
    const shot = file('image/png', 'shot.png');
    assert.equal(firstImageFromClipboard({ files: [shot], items: [] }), shot);
  });

  test('files 只有非图、items 里藏着图 → 回退到 items', () => {
    // 个别来源只把图放进 items，只读 files 会表现为"粘了没反应"
    const txt = file('text/plain', 'a.txt');
    const shot = file('image/png', 'shot.png');
    assert.equal(firstImageFromClipboard({ files: [txt], items: [item(null, 'string'), item(shot)] }), shot);
  });

  test('files 与 items 都有图 → files 优先', () => {
    const first = file('image/png', 'a.png');
    const second = file('image/jpeg', 'b.jpg');
    assert.equal(firstImageFromClipboard({ files: [first], items: [item(second)] }), first);
  });

  test('纯文本粘贴 → undefined（调用方据此不拦截默认行为）', () => {
    assert.equal(firstImageFromClipboard({ files: [], items: [item(null, 'string')] }), undefined);
  });

  test('items 里的 file 项取不到文件 → 跳过', () => {
    assert.equal(firstImageFromClipboard({ files: [], items: [item(null)] }), undefined);
  });

  test('空剪贴板 / undefined → undefined', () => {
    assert.equal(firstImageFromClipboard(null), undefined);
    assert.equal(firstImageFromClipboard(undefined), undefined);
    assert.equal(firstImageFromClipboard({}), undefined);
  });
});
