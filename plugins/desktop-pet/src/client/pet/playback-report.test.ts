/**
 * 点播回执（src/client/pet/playback-report.ts）的契约测试。
 *
 * 三条契约：
 *   1. 地址按播放编号拼，编号要编码（第三方编号可能带 `/` 与空格）；
 *   2. 有原因才带 `reason`，没有就只报 `status`——host 的 `?wait=` 与状态机按这两个字段收敛；
 *   3. 四种可上报状态都能走通（`accepted` 是宿主受理态，渲染端不许写）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { playbackReportRequest } from './playback-report.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import { REPORTABLE_STATUSES } from '../../shared/playback.ts';

describe('playbackReportRequest —— 回执请求', () => {
  test('地址：/playback/<id>/report，编号过编码', () => {
    const request = playbackReportRequest('pb/1 2', 'playing');
    assert.equal(request.url, ROUTE_PATH + '/playback/' + encodeURIComponent('pb/1 2') + '/report');
  });

  test('无原因：只带 status', () => {
    assert.deepEqual(playbackReportRequest('pb1', 'playing').body, { status: 'playing' });
  });

  test('有原因：status 与 reason 都带', () => {
    assert.deepEqual(playbackReportRequest('pb1', 'failed', 'asset-load').body, {
      status: 'failed',
      reason: 'asset-load',
    });
  });

  test('四种可上报状态都能拼出请求', () => {
    for (const status of REPORTABLE_STATUSES) {
      const request = playbackReportRequest('pb1', status);
      assert.equal(request.body.status, status);
      assert.ok(request.url.endsWith('/report'));
    }
  });
});
