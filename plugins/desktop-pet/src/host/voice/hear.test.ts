/**
 * 语音识别服务的测试（src/host/voice/hear.ts）。
 * 只断言服务自己的规则：输入校验、宿主能力缺失的降级、结论映射；不发真实请求、不碰音频格式。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createHearService, MAX_AUDIO_BYTES, type HearResult } from './hear.ts';
import { registerSpeechProvider, resetSpeechProviders } from './speech-registry.ts';

// 注册表是模块单例：每个用例结束都清空，避免第三方实现串到下一个用例。
afterEach(() => {
  resetSpeechProviders();
});

/** 一段假音频：服务不做格式校验，内容随意。 */
const AUDIO = new Uint8Array([1, 2, 3, 4]);

/** 按渲染端的形态把字节编成 base64。 */
const encode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** 一次 resolve 的实参记录。 */
interface ResolveCall {
  readonly audio: Uint8Array;
  readonly language?: string;
}

/** 造假宿主服务：登记表与转写都可替身，并把 resolve 的实参记下来。 */
function makeSpeech(
  overrides: {
    providers?: readonly unknown[];
    transcribe?: (spec: unknown, signal: AbortSignal) => Promise<{ text: string }>;
  } = {},
): { service: unknown; calls: ResolveCall[] } {
  const calls: ResolveCall[] = [];
  const service = {
    listProviders: () => overrides.providers ?? [{ id: 'sensevoice' }],
    resolve: (request: ResolveCall) => {
      calls.push(request);
      return { pinned: request };
    },
    // 宿主返回的是成品对象而不是裸字符串：这里照真实形状造假，否则测不出取错字段。
    transcribe: overrides.transcribe ?? (async () => ({ text: '你好' })),
  };
  return { service, calls };
}

/** 用给定宿主服务跑一次识别；`timeoutMs` 只在超时用例里给。 */
async function hearWith(speech: unknown, raw: unknown, timeoutMs?: number): Promise<HearResult> {
  return createHearService({ speechToText: () => speech, timeoutMs }).hear(raw);
}

test('缺 audio：bad-request，且不调用宿主服务', async () => {
  const speech = makeSpeech();
  const result = await hearWith(speech.service, {});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'bad-request');
  assert.equal(speech.calls.length, 0, '输入不合法时不应惊动宿主');
});

test('audio 不是 base64：bad-request', async () => {
  const result = await hearWith(makeSpeech().service, { audio: '这不是 base64' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'bad-request');
});

test('audio 为空串：bad-request', async () => {
  const result = await hearWith(makeSpeech().service, { audio: '   ' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'bad-request');
});

test('audio 超过上限：bad-request，且不调用宿主服务', async () => {
  const speech = makeSpeech();
  const result = await hearWith(speech.service, { audio: encode(new Uint8Array(MAX_AUDIO_BYTES + 1)) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'bad-request');
  assert.equal(speech.calls.length, 0);
});

test('宿主没有 speechToText 服务：unsupported，而不是当成失败', async () => {
  const result = await hearWith(undefined, { audio: encode(AUDIO) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'unsupported');
});

test('宿主有服务但没有识别器：unsupported，且不调用转写', async () => {
  let transcribed = 0;
  const speech = makeSpeech({
    providers: [],
    transcribe: async () => {
      transcribed++;
      return { text: '不该出现' };
    },
  });
  const result = await hearWith(speech.service, { audio: encode(AUDIO) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'unsupported');
  assert.equal(transcribed, 0);
});

test('正常识别：返回文字，并把原始字节交给宿主', async () => {
  const speech = makeSpeech();
  const result = await hearWith(speech.service, { audio: encode(AUDIO) });
  assert.deepEqual(result, { ok: true, text: '你好' });
  assert.equal(speech.calls.length, 1);
  assert.deepEqual(new Uint8Array(speech.calls[0]?.audio ?? new Uint8Array()), AUDIO);
});

test('识别结果为空串：仍算成功，是否提示由调用方决定', async () => {
  const result = await hearWith(makeSpeech({ transcribe: async () => ({ text: '' }) }).service, {
    audio: encode(AUDIO),
  });
  assert.deepEqual(result, { ok: true, text: '' });
});

test('language 原样透传给宿主', async () => {
  const speech = makeSpeech();
  await hearWith(speech.service, { audio: encode(AUDIO), language: ' zh ' });
  assert.equal(speech.calls[0]?.language, 'zh');
});

test('language 不是非空字符串：bad-request', async () => {
  for (const language of ['', '   ', 42]) {
    const result = await hearWith(makeSpeech().service, { audio: encode(AUDIO), language });
    assert.equal(result.ok, false, `language=${JSON.stringify(language)} 应被拒绝`);
    if (result.ok) continue;
    assert.equal(result.reason, 'bad-request');
  }
});

test('转写抛错：归一成 generate-error，并保留原始说明', async () => {
  const speech = makeSpeech({
    transcribe: async () => {
      throw new Error('Audio must be a canonical 16 kHz mono PCM16 WAV recording');
    },
  });
  const result = await hearWith(speech.service, { audio: encode(AUDIO) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'generate-error');
  assert.match(result.message, /canonical 16 kHz/);
});

test('转写超时：中断后回 generate-error，不会一直挂着', async () => {
  const speech = makeSpeech({
    // 永不兑现，只有 signal 能把它解开——验证超时真的接进了 provider。
    transcribe: (_spec, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  });
  const result = await hearWith(speech.service, { audio: encode(AUDIO) }, 10);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'generate-error');
});

test('注册了第三方：只走它，宿主完全不参与', async () => {
  let hostCalls = 0;
  const speech = makeSpeech({
    transcribe: async () => {
      hostCalls++;
      return { text: '宿主的答案' };
    },
  });
  registerSpeechProvider({ id: 'my-asr', name: '我的识别', transcribe: async () => '第三方答案' });
  const result = await hearWith(speech.service, { audio: encode(AUDIO) });
  assert.deepEqual(result, { ok: true, text: '第三方答案' });
  assert.equal(hostCalls, 0, '注册后不该再调用宿主');
});

test('第三方抛错：回 generate-error，且不回落宿主', async () => {
  let hostCalls = 0;
  const speech = makeSpeech({
    transcribe: async () => {
      hostCalls++;
      return { text: '不该出现' };
    },
  });
  registerSpeechProvider({
    id: 'my-asr',
    name: '坏实现',
    transcribe: async () => {
      throw new Error('upstream 500');
    },
  });
  const result = await hearWith(speech.service, { audio: encode(AUDIO) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'generate-error');
  assert.match(result.message, /upstream 500/);
  assert.equal(hostCalls, 0, '不回落：宿主不该被悄悄调用');
});

test('第三方返回空串：算成功（这段没人说话）', async () => {
  registerSpeechProvider({ id: 'my-asr', name: '安静', transcribe: async () => '' });
  const result = await hearWith(makeSpeech().service, { audio: encode(AUDIO) });
  assert.deepEqual(result, { ok: true, text: '' });
});

test('第三方返回非字符串：按失败处理，不把对象塞进 text', async () => {
  registerSpeechProvider({ id: 'my-asr', name: '乱回', transcribe: async () => ({ text: '坏' }) as never });
  const result = await hearWith(makeSpeech().service, { audio: encode(AUDIO) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'generate-error');
  assert.match(result.message, /invalid transcript/);
});

test('第三方超时：能被打断，不会一直挂着', async () => {
  registerSpeechProvider({
    id: 'my-asr',
    name: '慢实现',
    transcribe: (_input, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  });
  const result = await hearWith(makeSpeech().service, { audio: encode(AUDIO) }, 10);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'generate-error');
});

test('第三方拿到的是已解码的字节与语言', async () => {
  let seen: { audio: Uint8Array; language?: string } | undefined;
  registerSpeechProvider({
    id: 'my-asr',
    name: '记录',
    transcribe: async (input) => {
      seen = input;
      return '好';
    },
  });
  await hearWith(makeSpeech().service, { audio: encode(AUDIO), language: 'zh' });
  assert.deepEqual(new Uint8Array(seen?.audio ?? new Uint8Array()), AUDIO);
  assert.equal(seen?.language, 'zh');
});

test('注销之后：回到宿主那条路', async () => {
  const dispose = registerSpeechProvider({ id: 'my-asr', name: '临时', transcribe: async () => '第三方' });
  dispose();
  const result = await hearWith(makeSpeech().service, { audio: encode(AUDIO) });
  assert.deepEqual(result, { ok: true, text: '你好' }, '注销后应重新走宿主');
});
