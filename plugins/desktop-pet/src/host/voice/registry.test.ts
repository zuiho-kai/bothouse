/**
 * 第三方语音注册表的行为测试（src/host/voice/registry.ts）。
 *
 * 只钉「谁生效、谁被覆盖、注销是否只删自己」——合成与缓存不在本模块，另有测试。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  BUILTIN_VOICE_ID,
  activeVoiceProvider,
  listVoiceProviders,
  registerVoiceProvider,
  resetVoiceProviders,
} from './registry.ts';

/** 造一个最小实现；只关心 id，synthesize 返回一字节占位。 */
const provider = (id: string) => ({
  id,
  name: id,
  synthesize: async () => new Uint8Array([1]),
});

afterEach(() => {
  resetVoiceProviders();
});

test('初始状态：没有第三方实现，list 的 external 为空', () => {
  assert.equal(activeVoiceProvider(), null);
  assert.deepEqual(listVoiceProviders(), { builtin: [BUILTIN_VOICE_ID], external: [] });
});

test('注册之后：active 返回它，list 报出 id', () => {
  registerVoiceProvider(provider('my-tts'));
  assert.equal(activeVoiceProvider()?.id, 'my-tts');
  assert.deepEqual(listVoiceProviders(), { builtin: [BUILTIN_VOICE_ID], external: ['my-tts'] });
});

test('后注册覆盖先注册：单槽只有一个生效', () => {
  registerVoiceProvider(provider('first'));
  registerVoiceProvider(provider('second'));
  assert.equal(activeVoiceProvider()?.id, 'second');
  assert.deepEqual(listVoiceProviders().external, ['second']);
});

test('注销只清自己那份：先注册的注销不会顶掉后来者', () => {
  const disposeFirst = registerVoiceProvider(provider('first'));
  registerVoiceProvider(provider('second'));
  disposeFirst();
  assert.equal(activeVoiceProvider()?.id, 'second', '迟到的注销不该清掉新实现');
});

test('注销当前生效的那份：回到内置', () => {
  const dispose = registerVoiceProvider(provider('my-tts'));
  dispose();
  assert.equal(activeVoiceProvider(), null);
  assert.deepEqual(listVoiceProviders().external, []);
});

test('非法定义一律抛 TypeError', () => {
  assert.throws(() => registerVoiceProvider(null as never), TypeError, '非对象');
  assert.throws(
    () => registerVoiceProvider({ id: '', name: 'x', synthesize: async () => new Uint8Array() }),
    TypeError,
    '空 id',
  );
  assert.throws(
    () => registerVoiceProvider({ id: BUILTIN_VOICE_ID, name: 'x', synthesize: async () => new Uint8Array() }),
    TypeError,
    '与内置同名',
  );
  assert.throws(
    () => registerVoiceProvider({ id: 'x', name: 'x', synthesize: 1 as never }),
    TypeError,
    'synthesize 不是函数',
  );
});
