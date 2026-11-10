/**
 * 素材地址拼装（src/client/pet/animation/assets.ts）的契约测试。
 *
 * 三条契约：
 *   1. 点播地址优先：第三方给的完整 url 不许被路由拼接覆盖；
 *   2. 中文与空格必须编码：两个路径段都过 `encodeURIComponent`，否则宿主路由匹配不上；
 *   3. 素材根缺失时退到宠物 id（多实例共享素材目录时素材根才是真前缀）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { animationAssetUrl } from './assets.ts';
import { ROUTE_PATH } from '../../../shared/constants.ts';

describe('animationAssetUrl —— 动画素材地址', () => {
  test('普通情况：按素材根 + 动画名 + 扩展名拼宿主路由', () => {
    assert.equal(
      animationAssetUrl({ assetRoot: 'duck', id: 'pet-1', anim: 'idle1', ext: '.webm' }),
      ROUTE_PATH + '/thumb/duck/idle1.webm',
    );
  });

  test('点播地址优先，且不再拼路由', () => {
    const url = 'https://example.com/a/b.webm';
    assert.equal(animationAssetUrl({ cueUrl: url, assetRoot: 'duck', id: 'pet-1', anim: 'x', ext: '.webm' }), url);
  });

  test('中文与空格两段都编码', () => {
    const url = animationAssetUrl({ assetRoot: '小 鸭', id: 'pet-1', anim: '转 身', ext: '.webm' });
    assert.equal(
      url,
      ROUTE_PATH + '/thumb/' + encodeURIComponent('小 鸭') + '/' + encodeURIComponent('转 身') + '.webm',
    );
    assert.ok(!/[\u4e00-\u9fff\s]/.test(url), '地址里不能留着未编码的中文或空格');
  });

  test('素材根为空串时退到宠物 id', () => {
    assert.equal(
      animationAssetUrl({ assetRoot: '', id: 'pet-2', anim: 'idle1', ext: '.webm' }),
      ROUTE_PATH + '/thumb/pet-2/idle1.webm',
    );
  });
});
