/**
 * 应答构造器的契约测试：结论决定状态码，体永远是同一实体。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  failureBody,
  failResult,
  internalError,
  invalidJson,
  methodNotAllowed,
  okResult,
  payloadTooLarge,
} from './result.ts';

test('okResult：200，响应体就是结果本身', () => {
  const r = okResult({ ok: true, n: 1 });
  assert.equal(r.kind, 'json');
  assert.equal(r.kind === 'json' ? r.status : undefined, 200);
  assert.deepEqual(r.kind === 'json' ? r.obj : undefined, { ok: true, n: 1 });
});

test('okResult：可带缓存头', () => {
  const r = okResult({ counter: 0 }, { 'cache-control': 'no-cache' });
  assert.deepEqual(r.kind === 'json' ? r.headers : undefined, { 'cache-control': 'no-cache' });
});

test('failResult：业务失败一律 200 + 失败实体', () => {
  const r = failResult('unknown-pet', '没有这只桌宠：ghost');
  assert.deepEqual(r, {
    kind: 'json',
    status: 200,
    obj: { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：ghost' },
  });
});

test('failResult：附加字段进体，但覆盖不掉 ok / reason / message', () => {
  const r = failResult('locked', '占用中', { expiresAt: 123, ok: true, reason: 'bad-request' });
  assert.deepEqual(r, {
    kind: 'json',
    status: 200,
    obj: { ok: false, reason: 'locked', message: '占用中', expiresAt: 123 },
  });
});

test('协议失败：真实状态码 + 同一实体形状', () => {
  const cases: Array<[ReturnType<typeof invalidJson>, number, string]> = [
    [invalidJson(), 400, 'invalid-json'],
    [methodNotAllowed(), 405, 'method-not-allowed'],
    [payloadTooLarge(), 413, 'payload-too-large'],
    [internalError(), 500, 'internal-error'],
  ];
  for (const [r, status, reason] of cases) {
    assert.equal(r.kind === 'json' ? r.status : undefined, status);
    const obj = r.kind === 'json' ? (r.obj as Record<string, unknown>) : {};
    assert.equal(obj.ok, false, reason);
    assert.equal(obj.reason, reason);
    assert.equal(typeof obj.message, 'string');
  }
});

test('failureBody：与状态码无关，只描述结论', () => {
  assert.deepEqual(failureBody('bad-request', 'x'), { ok: false, reason: 'bad-request', message: 'x' });
});
