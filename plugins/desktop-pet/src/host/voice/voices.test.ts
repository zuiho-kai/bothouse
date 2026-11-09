/**
 * 音色白名单的行为测试（src/host/voice/voices.ts）。
 * 只钉住「校验与列表同源」这条契约：默认音色必须真的在列表里。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_VOICE, VOICES, isKnownVoice } from './voices.ts';

test('isKnownVoice：白名单内的 id 命中，任意串不命中', () => {
  assert.equal(isKnownVoice('zh-CN-XiaoxiaoNeural'), true);
  assert.equal(isKnownVoice('zh-CN-MadeUpNeural'), false);
  assert.equal(isKnownVoice(''), false);
});

test('DEFAULT_VOICE：必须在列表里，且恰好一个 default', () => {
  assert.equal(isKnownVoice(DEFAULT_VOICE), true, '默认音色不能落在白名单外');
  const defaults = VOICES.filter((voice) => voice.default);
  assert.equal(defaults.length, 1, 'default 标记必须唯一');
  assert.equal(defaults[0]?.id, DEFAULT_VOICE);
});
