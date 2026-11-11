/**
 * 管道应答映射的单元测试（素材走文件、文本与 JSON 走 body、无需应答落 204）。
 *
 * 钉住的不变式：
 *   - id 原样带回：管道上并存的请求靠它配对，串号等于把 A 的响应交给 B；
 *   - 素材恒 200 且只带路径，正文交给主进程读盘（大视频不进管道）；
 *   - 业务失败（200 + ok:false）原样透传，不在这一层改状态码。
 *
 * 跑法：node --experimental-strip-types --test src/host/plugin/desktop/bridge-response.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { toBridgeResponse } from './bridge-response.ts';

describe('toBridgeResponse —— 路由结果 → 管道应答', () => {
  test('素材：恒 200，只带文件路径与类型（正文由主进程读盘）', () => {
    const res = toBridgeResponse(7, { kind: 'file', file: '/tmp/a.webm', contentType: 'video/webm' });
    assert.deepEqual(res, { id: 7, status: 200, contentType: 'video/webm', file: '/tmp/a.webm' });
  });

  test('文本：状态码与正文原样带回，类型固定 text/plain', () => {
    const res = toBridgeResponse(2, { kind: 'text', status: 404, body: 'not found' });
    assert.deepEqual(res, { id: 2, status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
  });

  test('JSON：业务失败体原样透传（200 + ok:false 不在这一层改成 5xx）', () => {
    const obj = { ok: false, reason: 'invalid-config' };
    const res = toBridgeResponse(3, { kind: 'json', status: 200, obj });
    assert.equal(res.status, 200);
    assert.equal(res.contentType, 'application/json; charset=utf-8');
    assert.deepEqual(JSON.parse(res.body ?? ''), obj);
  });

  test('JSON：非 2xx 也照传（405/413 由路由决定，映射层不改判）', () => {
    const res = toBridgeResponse(4, { kind: 'json', status: 405, obj: { ok: false, reason: 'method-not-allowed' } });
    assert.equal(res.status, 405);
  });

  test('无需应答：落成空的 204（连接已断开，不写正文）', () => {
    const res = toBridgeResponse(5, { kind: 'none' });
    assert.deepEqual(res, { id: 5, status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
  });

  test('id 原样带回：并存的两次请求不会串号', () => {
    const first = toBridgeResponse(11, { kind: 'text', status: 200, body: 'a' });
    const second = toBridgeResponse(12, { kind: 'text', status: 200, body: 'b' });
    assert.equal(first.id, 11);
    assert.equal(second.id, 12);
  });
});
