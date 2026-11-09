/**
 * HTTP 管道（src/host/http.ts）的契约测试：请求体读取、单段 Range 解析、sendFile 的 Range 应答。
 * readBody/parseRange 用假请求与纯函数驱动；sendFile 用本机临时 server 发真实请求。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAX_BODY_BYTES, parseRange, readBody, sendFile } from './http.ts';

/** 假请求：只保留 readBody 用到的 on/off 与 destroy。 */
function fakeReq() {
  const emitter = new EventEmitter();
  const destroyed: boolean[] = [];
  const req = {
    on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener),
    off: (event: string, listener: (...args: unknown[]) => void) => emitter.off(event, listener),
    destroy: () => destroyed.push(true),
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
  };
  return { req: req as unknown as Parameters<typeof readBody>[0], destroyed, emitter: req };
}

describe('readBody —— 正常读取', () => {
  test('分片到达：拼成完整文本', async () => {
    const { req, emitter } = fakeReq();
    const pending = readBody(req);
    emitter.emit('data', Buffer.from('{"a":'));
    emitter.emit('data', Buffer.from('1}'));
    emitter.emit('end');
    assert.equal(await pending, '{"a":1}');
  });

  test('读完后 close 再来也不会改变结果', async () => {
    const { req, emitter } = fakeReq();
    const pending = readBody(req);
    emitter.emit('data', Buffer.from('x'));
    emitter.emit('end');
    assert.equal(await pending, 'x');
    emitter.emit('close');
  });
});

describe('readBody —— 拒绝路径', () => {
  test('超过上限：带 body-too-large 拒绝，并销毁请求', async () => {
    const { req, emitter, destroyed } = fakeReq();
    const pending = readBody(req);
    emitter.emit('data', Buffer.alloc(MAX_BODY_BYTES + 1));
    await assert.rejects(pending, (error: Error & { code?: string }) => {
      assert.equal(error.code, 'body-too-large');
      return true;
    });
    assert.deepEqual(destroyed, [true], '超限后应销毁连接');
  });

  test('客户端中断（close）：带 client-aborted 拒绝，不会永远挂着', async () => {
    const { req, emitter } = fakeReq();
    const pending = readBody(req);
    emitter.emit('data', Buffer.from('半截'));
    emitter.emit('close');
    await assert.rejects(pending, (error: Error & { code?: string }) => {
      assert.equal(error.code, 'client-aborted');
      return true;
    });
  });

  test('底层错误：原样透出', async () => {
    const { req, emitter } = fakeReq();
    const pending = readBody(req);
    const boom = new Error('socket hang up');
    emitter.emit('error', boom);
    await assert.rejects(pending, (error: Error) => error === boom);
  });
});

describe('parseRange —— 单段字节区间', () => {
  test('完整请求：bytes=0- → 整个文件', () => {
    assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
  });

  test('显式区间：bytes=100-199 → 只取这一段', () => {
    assert.deepEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199 });
  });

  test('开放结尾：bytes=500- → 从 500 到文件末尾', () => {
    assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  });

  test('后缀形式：bytes=-200 → 末尾 200 字节', () => {
    assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
  });

  test('后缀超过文件长度：bytes=-5000 → 整份', () => {
    assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
  });

  test('单字节：bytes=0-0 → 只取第 0 字节', () => {
    assert.deepEqual(parseRange('bytes=0-0', 1000), { start: 0, end: 0 });
  });

  test('末尾单字节：bytes=999- → 最后一个字节', () => {
    assert.deepEqual(parseRange('bytes=999-', 1000), { start: 999, end: 999 });
  });

  test('起点越界：bytes=1000- → unsatisfiable（回 416）', () => {
    assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
  });

  test('起点大于终点：bytes=200-100 → unsatisfiable（回 416）', () => {
    assert.equal(parseRange('bytes=200-100', 1000), 'unsatisfiable');
  });

  test('多段请求：bytes=0-99,200-299 → 忽略（回整份）', () => {
    assert.equal(parseRange('bytes=0-99,200-299', 1000), null);
  });

  test('单位不是 bytes：items=0-99 → 忽略', () => {
    assert.equal(parseRange('items=0-99', 1000), null);
  });

  test('语法非法：bytes=abc-def → 忽略', () => {
    assert.equal(parseRange('bytes=abc-def', 1000), null);
  });

  test('没有 Range 头：undefined → 忽略', () => {
    assert.equal(parseRange(undefined, 1000), null);
  });

  test('文件长度为 0：bytes=0- → 忽略', () => {
    assert.equal(parseRange('bytes=0-', 0), null);
  });

  test('后缀为 0：bytes=-0 → 忽略', () => {
    assert.equal(parseRange('bytes=-0', 1000), null);
  });
});

describe('sendFile —— Range 应答', () => {
  /** 1000 字节的确定性内容：第 i 字节 = i % 256，便于断言切片边界 */
  const payload = Buffer.from(Array.from({ length: 1000 }, (_value, index) => index % 256));
  let dir = '';
  let base = '';
  let close = (): void => {};

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-pet-range-'));
    const file = join(dir, 'clip.webm');
    writeFileSync(file, payload);
    // 每个测试文件自建 server、随机端口，结束时关闭（不依赖外部服务）
    const server = createServer((req, res) => sendFile(req, res, file, 'video/webm'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
    close = () => server.close();
  });

  after(() => {
    close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('无 Range：返回 200，body 是整份文件', async () => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).length, payload.length);
  });

  test('单段区间：bytes=100-199 → 206，只回这 100 字节', async () => {
    const response = await fetch(base, { headers: { range: 'bytes=100-199' } });
    assert.equal(response.status, 206);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, 100);
    assert.equal(body[0], 100);
    assert.equal(body[99], 199);
  });

  test('开放结尾：bytes=500- → 206，回 500..999', async () => {
    const response = await fetch(base, { headers: { range: 'bytes=500-' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 500-999/1000');
    assert.equal(Buffer.from(await response.arrayBuffer()).length, 500);
  });

  test('起点越界：bytes=1000- → 416，并声明文件总长', async () => {
    const response = await fetch(base, { headers: { range: 'bytes=1000-' } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */1000');
  });

  test('多段请求：bytes=0-99,200-299 → 200 整份（忽略 Range）', async () => {
    const response = await fetch(base, { headers: { range: 'bytes=0-99,200-299' } });
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).length, payload.length);
  });

  test('206 必须带 Content-Range 与切片长度，否则播放器仍会错位', async () => {
    const response = await fetch(base, { headers: { range: 'bytes=262-' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-length'), '738');
    assert.equal(response.headers.get('content-range'), 'bytes 262-999/1000');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
  });
});
