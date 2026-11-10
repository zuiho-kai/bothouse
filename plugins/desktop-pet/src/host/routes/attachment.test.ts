/**
 * `GET /attachment` 的契约测试：id 形状校验、附件服务降级、文件头嗅探与 405。
 *
 * 直接测导出的路由处理函数，不启 HTTP 服务；附件对象用临时目录里的真实文件代替——
 * 路由的职责只是「拿服务给的路径 + 判断能不能显示」，不该自己拼路径。
 *
 * 跑法：node --experimental-strip-types --test src/host/routes/attachment.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { PetImageSink } from '../image-attachment.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { handleAttachmentRoutes } from './attachment.ts';

/** 合法 id：sha256 + 64 位小写 hex。 */
const ID = 'sha256:' + 'a'.repeat(64);

/** 四种可显示格式的文件头（不足 16 字节的补零，与真实对象一样只看头部）。 */
const HEADERS: Record<string, Buffer> = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  gif: Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(10)]),
  webp: Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(4)]),
};

/** 造最简依赖：只有 optionalService 是真的。 */
function makeDeps(sink?: PetImageSink): PetRouteDeps {
  return {
    optionalService: (name: string) => (name === 'attachments' ? sink : undefined),
  } as unknown as PetRouteDeps;
}

/** 一次取图请求；id 缺省时连查询参数都不带。 */
function request(id: string | undefined, method = 'GET'): RouteInput {
  const url = new URL('http://127.0.0.1/dsh-pet-7340/attachment');
  if (id !== undefined) url.searchParams.set('id', id);
  return { url, rest: 'attachment', method };
}

/** 把字节写成临时对象文件，返回其路径与服务桩（imageHostPath 回这个路径）。 */
function objectFile(bytes: Buffer): { file: string; sink: PetImageSink; clean: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-attachment-test-'));
  const file = join(dir, 'object');
  writeFileSync(file, bytes);
  const sink: PetImageSink = {
    saveImages: async () => [],
    imageHostPath: () => file,
  };
  return { file, sink, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('handleAttachmentRoutes —— 取图端点', () => {
  test('不是 /attachment 路径 → 不认领（交回分发器）', async () => {
    const input = { ...request(ID), rest: 'chat' };
    assert.equal(await handleAttachmentRoutes(makeDeps(), input), undefined);
  });

  test('非 GET → 405（取图是读端点，动作方法不该被接受）', async () => {
    const res = await handleAttachmentRoutes(makeDeps(), request(ID, 'POST'));
    assert.equal(res?.kind, 'text');
    assert.equal((res as { status: number }).status, 405);
  });

  test('id 缺失或形状不对 → 400，且不去碰附件服务', async () => {
    let touched = false;
    const sink = { saveImages: async () => [], imageHostPath: () => ((touched = true), undefined) } as PetImageSink;
    for (const bad of [undefined, '', 'abc', 'sha256:', 'sha256:' + 'A'.repeat(64), 'sha256:' + 'a'.repeat(63)]) {
      const res = await handleAttachmentRoutes(makeDeps(sink), request(bad));
      assert.equal((res as { status: number }).status, 400, String(bad));
    }
    assert.equal(touched, false, '非法 id 必须在调用服务之前就被挡下');
  });

  test('独立模式：没有附件服务 → 404（与 POST /chat 的图片能力同一降级口径）', async () => {
    const res = await handleAttachmentRoutes(makeDeps(), request(ID));
    assert.equal((res as { status: number }).status, 404);
  });

  test('后端不是文件式 / 引用被拒（抛错）→ 404，不把内部文案漏给客户端', async () => {
    const noPath = { saveImages: async () => [] } as PetImageSink;
    assert.equal(((await handleAttachmentRoutes(makeDeps(noPath), request(ID))) as { status: number }).status, 404);
    const throwing = {
      saveImages: async () => [],
      imageHostPath: () => {
        throw new Error('INVALID_ATTACHMENT_REF');
      },
    } as PetImageSink;
    const res = await handleAttachmentRoutes(makeDeps(throwing), request(ID));
    assert.equal((res as { kind: 'text'; body: string }).body, 'dsh-pet: attachment not found');
  });

  test('对象已被清掉（路径存在但文件不在）→ 404', async () => {
    const sink: PetImageSink = { saveImages: async () => [], imageHostPath: () => '/nonexistent/dsh-pet/object' };
    const res = await handleAttachmentRoutes(makeDeps(sink), request(ID));
    assert.equal((res as { status: number }).status, 404);
  });

  for (const [label, bytes, expected] of [
    ['PNG', HEADERS.png!, 'image/png'],
    ['JPEG', HEADERS.jpeg!, 'image/jpeg'],
    ['GIF', HEADERS.gif!, 'image/gif'],
    ['WebP', HEADERS.webp!, 'image/webp'],
  ] as const) {
    test(`${label} 文件头 → 按 file 应答且 Content-Type 为 ${expected}`, async () => {
      const obj = objectFile(bytes);
      try {
        const res = await handleAttachmentRoutes(makeDeps(obj.sink), request(ID));
        assert.equal(res?.kind, 'file');
        assert.equal((res as { file: string }).file, obj.file);
        assert.equal((res as { contentType: string }).contentType, expected);
      } finally {
        obj.clean();
      }
    });
  }

  test('不是图片的字节 → 404（不按 octet-stream 硬发出去）', async () => {
    const obj = objectFile(Buffer.from('{"not":"an image"}'));
    try {
      const res = await handleAttachmentRoutes(makeDeps(obj.sink), request(ID));
      assert.equal((res as { status: number }).status, 404);
    } finally {
      obj.clean();
    }
  });
});
