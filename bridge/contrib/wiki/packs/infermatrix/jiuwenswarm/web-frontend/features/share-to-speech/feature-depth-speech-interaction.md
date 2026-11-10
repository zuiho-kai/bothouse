---
name: feature-depth-speech-interaction
description: 语音输入、回复朗读与停止的实现深读：useTaskAsr 录音失败与卸载清理、startRecording 守卫与 transcribe 流程、task.asr.transcribe 与 tts.synthesize 请求契约、Task ASR 开关默认值、mountedRef 取舍及 README 手动验收步骤（未执行）
metadata:
  scope: 只收 useTaskAsr、fetchTtsAudio、featureFlag 的七个 facet 深读；职责边界与整体配置入口归 feature-speech-interaction
---
# 语音输入、回复朗读与停止：实现深读

## 现状

- [[feature-speech-interaction]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **录音失败丢弃、空转写报错与卸载清理** recorder.onerror 置 discardRecordingRef = true、释放麦克风并回调 'Microphone recording failed'；onstop 在 discard 或 chunks 为空时直接返回、不转写。ASR 返回空文本时抛出 'ASR did not return any text' 并经 onError 传播。组件卸载的 cleanup 置 discardRecordingRef = true、停掉仍在 recording 的 recorder 并释放麦克风，防止卸载后触发转写。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L130–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L130-L146),
  - [jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L83–L90](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L83-L90),
  - [jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L168–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L168-L178)
- **useTaskAsr：startRecording 带守卫取麦克风，transcribe 转写后经 onTranscript 回传** startRecording 在 `!isSupported || isRecording || isTranscribing` 时直接 return，否则 getUserMedia（echoCancellation/noiseSuppression/autoGainControl 全开），未挂载则停轨道；
  - transcribe(blob) 对 `!blob.size || !mountedRef.current` 静默 return，经 blobBase64 以 `task.asr.transcribe`（timeoutMs 130_000）转写，trim 非空文本经 onTranscript 回调。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L107–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L107-L124),
  - [jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L72–L94](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L72-L94)
- **task.asr.transcribe 与 tts.synthesize 的请求参数、超时与返回契约** transcribe 发送 `{ audio_base64, mime_type: blob.type || 'audio/webm' }`，选项 `{ timeoutMs: 130_000 }`，结果取 `response.text?.trim()`；fetchTtsAudio 发送 `{ text }`（可选 `session_id`）并透传 AbortSignal 调 `tts.synthesize`，空文本或请求出错时返回 null 而非抛出。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L76–L85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L76-L85),
  - [jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L89–L111](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/tts.ts#L89-L111)
- **Task ASR 开关：模块级默认 false，getServerSnapshot 恒返回 true** 模块级 `enabled = false` 起始；`setTaskAsrEnabled(next)` 值未变时直接 return，变化时遍历 listeners 通知；`useTaskAsrEnabled` 经 useSyncExternalStore 读取 `enabled`，getServerSnapshot 固定返回 true。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts:L3–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts#L3-L21)
- **ASR 与 TTS 复用 webClient 的 webRequest，错误传播路径不同** 两条语音路径共用 services/webClient 的 webRequest：transcribe 发 'task.asr.transcribe'（audio_base64、mime_type，timeoutMs 130_000），fetchTtsAudio 发 'tts.synthesize'（trim 后文本，可选 session_id 与 signal）。抛错时 ASR 在 mountedRef 为真时经 onError 上报；
  - TTS 捕获后 console.warn 并返回 null。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L2–L2](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L2-L2),
  - [jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L76–L90](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L76-L90),
  - [jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L5–L5](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/tts.ts#L5-L5),
  - [jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L94–L111](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/tts.ts#L94-L111)
- **useTaskAsr 的 transcribe：mountedRef 守卫换来卸载后不触发回调与状态更新，迟到的转写文本在该分支被跳过** 设计推断（非作者历史意图）：
- transcribe 在 `!blob.size || !mountedRef.current` 时直接返回；成功路径 `if (mountedRef.current) onTranscriptRef.current(text)` 与 finally 中的 `setIsTranscribing` 受同一守卫。推断收益：组件卸载后不再触发回调或状态更新；推断代价：卸载后才返回的转写文本在此分支被跳过，不经此路径送达。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L72–L94](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L72-L94)
- **README 45–48 行文档化的语音交互手动步骤（未执行）** 文档中的人工验收步骤（本轮未执行）：
- README 45–48 行记录手动操作与预期结果：点击麦克风按钮进行语音输入（STT）；鼠标悬停在 AI 回复上显示朗读按钮（TTS）；语音输入时可随时打断 AI 处理。本文按文档化手动流程引用该步骤，未执行。
- 来源：[jiuwenswarm/channels/web/frontend/README.md:L45–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/README.md#L45-L48)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-speech-interaction.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L130-L146
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L83-L90
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L168-L178
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L107-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L72-L94
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L76-L85；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L89-L111
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts:L3-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L2-L2
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L76-L90；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L5-L5
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L94-L111；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/README.md:L45-L48
- 源页字段（feature）：speech-interaction
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts；jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts；jiuwenswarm/channels/web/frontend/src/utils/tts.ts；jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts；jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts；jiuwenswarm/channels/web/frontend/src/utils/tts.ts；jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts
