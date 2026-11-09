/**
 * 第三方语音识别注册表的行为测试（src/host/voice/speech-registry.ts）。
 *
 * 只钉「谁生效、谁被覆盖、注销是否只删自己」——识别与超时不在本模块，另有测试。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  BUILTIN_SPEECH_ID,
  activeSpeechProvider,
  listSpeechProviders,
  registerSpeechProvider,
  resetSpeechProviders,
} from './speech-registry.ts';

/** 造一个最小实现；只关心 id，transcribe 返回固定文字。 */
const provider = (id: string) => ({
  id,
  name: id,
  transcribe: async () => '好',
});

afterEach(() => {
  resetSpeechProviders();
});

test('初始状态：没有第三方实现，list 的 external 为空', () => {
  assert.equal(activeSpeechProvider(), null);
  assert.deepEqual(listSpeechProviders(), { builtin: [BUILTIN_SPEECH_ID], external: [] });
});

test('注册之后：active 返回它，list 报出 id', () => {
  registerSpeechProvider(provider('my-asr'));
  assert.equal(activeSpeechProvider()?.id, 'my-asr');
  assert.deepEqual(listSpeechProviders(), { builtin: [BUILTIN_SPEECH_ID], external: ['my-asr'] });
});

test('后注册覆盖先注册：单槽只有一个生效', () => {
  registerSpeechProvider(provider('first'));
  registerSpeechProvider(provider('second'));
  assert.equal(activeSpeechProvider()?.id, 'second');
  assert.deepEqual(listSpeechProviders().external, ['second']);
});

test('注销只清自己那份：先注册的注销不会顶掉后来者', () => {
  const disposeFirst = registerSpeechProvider(provider('first'));
  registerSpeechProvider(provider('second'));
  disposeFirst();
  assert.equal(activeSpeechProvider()?.id, 'second', '迟到的注销不该清掉新实现');
});

test('注销当前生效的那份：回到没有第三方', () => {
  const dispose = registerSpeechProvider(provider('my-asr'));
  dispose();
  assert.equal(activeSpeechProvider(), null);
  assert.deepEqual(listSpeechProviders().external, []);
});

test('非法定义一律抛 TypeError', () => {
  assert.throws(() => registerSpeechProvider(null as never), TypeError, '非对象');
  assert.throws(() => registerSpeechProvider({ id: '', name: 'x', transcribe: async () => '' }), TypeError, '空 id');
  assert.throws(
    () => registerSpeechProvider({ id: BUILTIN_SPEECH_ID, name: 'x', transcribe: async () => '' }),
    TypeError,
    '与内置来源同名',
  );
  assert.throws(
    () => registerSpeechProvider({ id: 'x', name: 'x', transcribe: 1 as never }),
    TypeError,
    'transcribe 不是函数',
  );
});
