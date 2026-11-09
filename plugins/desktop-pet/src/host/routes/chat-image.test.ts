/**
 * `POST /chat` 的图片入参契约测试：校验顺序、附件准入与引用透传。
 *
 * 直接测导出的路由处理函数，不走 apply()：图片准入发生在读配置之前，而源码形态下内置配置
 * 不可达（readAllConfig 会抛），整机 harness 到不了这一层。最小依赖桩同时钉住了一条顺序不变量——
 * 图片被拒时 chatWithPet 一次都不该被调用。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { PetImageRef, PetImageSink } from '../image-attachment.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { handleChatRoutes } from './chat.ts';

/** 最小 PNG 头：8 字节，足够走完准入 */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BASE64 = PNG_BYTES.toString('base64');

/** 一次 chatWithPet 调用（用来断言路由把什么透传下去了） */
type ChatCall = { petId: string; text: string; image?: PetImageRef };

/** 造最小路由依赖；只有 chat 分支用到的成员是真的，其余按接口形状占位。 */
function makeDeps(sink?: PetImageSink): { deps: PetRouteDeps; calls: ChatCall[] } {
  const calls: ChatCall[] = [];
  const deps = {
    configPaths: {},
    log: { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} },
    memoryPath: '/tmp/dsh-pet-memory.json',
    memoryRounds: () => 5,
    readMemory: async () => ({}),
    requirePet: () => ({ ok: true, petId: 'main', entry: 'main', conf: {} }),
    optionalService: (name: string) => (name === 'attachments' ? sink : undefined),
    chatWithPet: async (petId: string, text: string, image?: PetImageRef) => {
      calls.push({ petId, text, image });
      return { ok: true as const, text: '嗯' };
    },
  } as unknown as PetRouteDeps;
  return { deps, calls };
}

/** 造附件服务桩；`saved` 记录实际交进来的字节，`overrides` 用来构造超限/抛错分支。 */
function makeSink(overrides: Partial<PetImageSink> = {}): {
  sink: PetImageSink;
  saved: { data: Uint8Array; mediaType: string }[];
} {
  const saved: { data: Uint8Array; mediaType: string }[] = [];
  const sink: PetImageSink = {
    imageLimits: { maxImageBytes: 1024 },
    saveImages: async (inputs) => {
      saved.push(...inputs);
      return inputs.map((input) => ({
        attachmentId: 'sha256:' + 'a'.repeat(64),
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 8,
        height: 8,
      }));
    },
    ...overrides,
  };
  return { sink, saved };
}

/** 一次 POST /chat 调用；URL 只是占位，pet 与 surface 由 requirePet 桩决定。 */
function postChat(body: unknown): RouteInput {
  return {
    url: new URL('http://127.0.0.1/dsh-pet-7340/chat?pet=main&surface=web'),
    rest: 'chat',
    method: 'POST',
    body: JSON.stringify(body),
  };
}

/** 从 RouteResult 里取 JSON 体（断言用）。 */
function jsonBody(result: Awaited<ReturnType<typeof handleChatRoutes>>): Record<string, unknown> {
  assert.equal(result?.kind, 'json');
  return (result as { obj: Record<string, unknown> }).obj;
}

describe('POST /chat 的 attachment', () => {
  test('不传 attachment：走原路径，chatWithPet 收到 undefined 图片 → 响应与形状不变', async () => {
    const { sink } = makeSink();
    const { deps, calls } = makeDeps(sink);
    const body = jsonBody(await handleChatRoutes(deps, postChat({ text: '  在吗  ' })));
    assert.equal(body.ok, true);
    assert.deepEqual(calls, [{ petId: 'main', text: '在吗', image: undefined }]);
  });

  test('mediaType 不在白名单 → bad-request，且不调用 chatWithPet', async () => {
    const { deps, calls } = makeDeps(makeSink().sink);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '看图', attachment: { mediaType: 'image/bmp', data: PNG_BASE64 } }),
      ),
    );
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'bad-request');
    assert.equal(calls.length, 0);
  });

  test('base64 含非法字符 → bad-request，且不调用 chatWithPet', async () => {
    const { deps, calls } = makeDeps(makeSink().sink);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '看图', attachment: { mediaType: 'image/png', data: PNG_BASE64 + '!' } }),
      ),
    );
    assert.equal(body.reason, 'bad-request');
    assert.match(String(body.message), /base64/);
    assert.equal(calls.length, 0);
  });

  test('没有附件服务（独立模式）→ bad-request，文案指出不支持图片', async () => {
    const { deps, calls } = makeDeps(undefined);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '看图', attachment: { mediaType: 'image/png', data: PNG_BASE64 } }),
      ),
    );
    assert.equal(body.reason, 'bad-request');
    assert.match(String(body.message), /不支持图片/);
    assert.equal(calls.length, 0);
  });

  test('解码后超出部署上限 → bad-request，且不写附件', async () => {
    const { sink, saved } = makeSink({ imageLimits: { maxImageBytes: 4 } });
    const { deps, calls } = makeDeps(sink);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '看图', attachment: { mediaType: 'image/png', data: PNG_BASE64 } }),
      ),
    );
    assert.equal(body.reason, 'bad-request');
    assert.match(String(body.message), /图片过大/);
    assert.equal(saved.length, 0);
    assert.equal(calls.length, 0);
  });

  test('合法图片：附件服务收到原样字节，引用透传给对话层', async () => {
    const { sink, saved } = makeSink();
    const { deps, calls } = makeDeps(sink);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '屏幕上这个报错是什么', attachment: { mediaType: 'image/png', data: PNG_BASE64 } }),
      ),
    );
    assert.equal(body.ok, true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.mediaType, 'image/png');
    assert.deepEqual(saved[0]?.data, new Uint8Array(PNG_BYTES));
    assert.equal(calls.length, 1);
    // 正文原样透传：图片不往用户的话里拼任何东西
    assert.equal(calls[0]?.text, '屏幕上这个报错是什么');
    assert.match(String(calls[0]?.image?.attachmentId), /^sha256:/);
  });

  test('附件落盘失败 → generate-error（不伪装成调用方参数错误）', async () => {
    const { sink } = makeSink({
      saveImages: async () => {
        throw new Error('disk full');
      },
    });
    const { deps, calls } = makeDeps(sink);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '看图', attachment: { mediaType: 'image/png', data: PNG_BASE64 } }),
      ),
    );
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'generate-error');
    assert.equal(calls.length, 0);
  });

  test('文本为空时先按文本报错，不因为带了图就放行', async () => {
    const { sink } = makeSink();
    const { deps, calls } = makeDeps(sink);
    const body = jsonBody(
      await handleChatRoutes(deps, postChat({ text: '   ', attachment: { mediaType: 'image/png', data: PNG_BASE64 } })),
    );
    assert.equal(body.reason, 'bad-request');
    assert.equal(calls.length, 0);
  });
});
