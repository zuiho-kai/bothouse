/**
 * 对话发送的请求体契约：不带图时与旧版逐字一致，带图时多一个 attachment。
 *
 * 为什么值得钉：这是客户端与宿主之间唯一的线上契约。少发一个字段不会报错，
 * 只会让桌宠"看不见图"——排查起来要从模型一路倒推回来。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { sendChat } from './send.ts';

/**
 * 用桩替换全局 fetch 并收集请求体。
 *
 * @param response - 桩要回的 JSON 体。
 * @returns 收集到的 body 与恢复函数（每个用例 finally 里调用）。
 */
function captureFetch(response: unknown): { bodies: string[]; restore: () => void } {
  const bodies: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ''));
    return new Response(JSON.stringify(response), { status: 200 });
  }) as typeof fetch;
  return {
    bodies,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe('sendChat 请求体', () => {
  test('不带图：只有 text，与加入图片前逐字一致', async () => {
    const captured = captureFetch({ ok: true });
    try {
      const state = await sendChat('http://127.0.0.1/dsh-pet-7340/chat', '在吗');
      assert.equal(state.ok, true);
      assert.deepEqual(JSON.parse(captured.bodies[0] ?? '{}'), { text: '在吗' });
    } finally {
      captured.restore();
    }
  });

  test('带图：多一个 attachment，字段只有 mediaType 与 data', async () => {
    const captured = captureFetch({ ok: true });
    const attachment = { mediaType: 'image/jpeg', data: 'AAAA' };
    try {
      await sendChat('http://127.0.0.1/dsh-pet-7340/chat', '看图', attachment);
      assert.deepEqual(JSON.parse(captured.bodies[0] ?? '{}'), { text: '看图', attachment });
    } finally {
      captured.restore();
    }
  });

  test('宿主回 ok:false → 原因归一化，message 原样带回', async () => {
    const captured = captureFetch({ ok: false, reason: 'bad-request', message: '图片过大' });
    try {
      const state = await sendChat('http://127.0.0.1/dsh-pet-7340/chat', '看图');
      assert.deepEqual(state, { ok: false, reason: 'bad-request', message: '图片过大' });
    } finally {
      captured.restore();
    }
  });

  test('未知 reason 归一成 bad-request（消费方只需处理四种）', async () => {
    const captured = captureFetch({ ok: false, reason: 'something-new' });
    try {
      const state = await sendChat('http://127.0.0.1/dsh-pet-7340/chat', '在吗');
      assert.deepEqual(state, { ok: false, reason: 'bad-request', message: undefined });
    } finally {
      captured.restore();
    }
  });

  test('响应不是对象 → 抛错（调用方决定怎么提示）', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('null', { status: 200 })) as typeof fetch;
    try {
      await assert.rejects(() => sendChat('http://127.0.0.1/dsh-pet-7340/chat', '在吗'), /对话响应非法/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
