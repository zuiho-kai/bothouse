---
name: feature-speech-interaction
description: 语音输入、回复朗读与停止功能概览：任务 ASR 与 TTS 的职责边界、task.asr.transcribe/tts.synthesize 接口、录音上限与 ASR 开关、设计取舍、数据流关联功能与验证项
metadata:
  scope: 只收六节摘要与关联阅读；useTaskAsr 内部流程、失败与卸载细节归 feature-depth-speech-interaction
---
# 语音输入、回复朗读与停止的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-speech-interaction.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/utils/tts.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/README.md
- 源页字段（feature）：speech-interaction
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts；jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts；jiuwenswarm/channels/web/frontend/src/utils/tts.ts；jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts；jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts；jiuwenswarm/channels/web/frontend/src/utils/tts.ts；jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts
  - jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InputArea.tsx；jiuwenswarm/channels/web/frontend/src/utils/speechDetection/silero.worker.ts
  - jiuwenswarm/channels/web/frontend/src/utils/speechDetection/sileroVad.ts；jiuwenswarm/channels/web/frontend/src/utils/speechDetection/speechGate.ts
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- 任务 ASR 使用浏览器麦克风和 MediaRecorder 收集音频，再发送给后端识别并通过 onTranscript 返回文字；回复朗读通过 TTS 请求和全局音频播放控制完成。useSpeech 另提供浏览器 Web Speech 识别与合成 hook，存在代码不代表当前输入组件选择了该路径，接入位置需沿调用方核对。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L1–L186](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L1-L186)；
  - [jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts:L1–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts#L1-L21)；
  - [jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L1–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/tts.ts#L1-L139)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts:L1–L392](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts#L1-L392)；
  - [jiuwenswarm/channels/web/frontend/README.md:L1–L284](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/README.md#L1-L284)。

### 接口与调用入口（API）

- useTaskAsr 向 task.asr.transcribe 提交 audio_base64 与 mime_type，请求超时为一百三十秒，空文本作为错误。fetchTtsAudio 向 tts.synthesize 提交 text 和可选 session_id，playAudioBase64 播放响应音频；stopAllTts 停止全局音频、浏览器合成并广播停止事件，供多个朗读入口同步。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L1–L186](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L1-L186)；
  - [jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts:L1–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts#L1-L21)；
  - [jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L1–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/tts.ts#L1-L139)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts:L1–L392](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts#L1-L392)；
  - [jiuwenswarm/channels/web/frontend/README.md:L1–L284](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/README.md#L1-L284)。

### 配置入口与生效条件

- 任务录音上限为六十秒，浏览器必须支持 getUserMedia 和 MediaRecorder，格式从可支持的候选 MIME 中选择。任务 ASR feature flag 由 setTaskAsrEnabled 更新，模块初始值为关闭；TTS 文本预处理默认截到五百字符并省略代码与链接。后端模型服务的配置归媒体能力，客户端开关不能代替服务可用性。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L1–L186](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L1-L186)；
  - [jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts:L1–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts#L1-L21)；
  - [jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L1–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/tts.ts#L1-L139)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts:L1–L392](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts#L1-L392)；
  - [jiuwenswarm/channels/web/frontend/README.md:L1–L284](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/README.md#L1-L284)。

### 设计取舍

- **设计推断**：录音提交给后端可让任务输入复用模型服务，但要处理浏览器权限、编码和长请求；Web Speech hook 的支持则依赖浏览器实现。单个全局 TTS 音频避免多个回复同时朗读，代价是新播放会停止旧音频，并且播放可能被浏览器策略或音频格式拒绝。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L1–L186](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L1-L186)；
  - [jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts:L1–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts#L1-L21)；
  - [jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L1–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/tts.ts#L1-L139)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts:L1–L392](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts#L1-L392)；
  - [jiuwenswarm/channels/web/frontend/README.md:L1–L284](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/README.md#L1-L284)。

### 数据流与关联功能

- 用户录音后得到文字再进入任务输入，回复朗读先清理文本并请求音频，开始新播放或主动停止时更新全局播放状态。完整双工音视频扩展是另一条会话链路，图片与音频理解也有独立工具；录音 hook、旧浏览器识别和双工组件应分别检查实际宿主装配。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L1–L186](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L1-L186)；
  - [jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts:L1–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts#L1-L21)；
  - [jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L1–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/tts.ts#L1-L139)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts:L1–L392](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts#L1-L392)；
  - [jiuwenswarm/channels/web/frontend/README.md:L1–L284](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/README.md#L1-L284)。

### 怎样验证

- 覆盖权限拒绝、不支持录音 API、录音上限、空识别结果、长请求失败与卸载时麦克风轨道清理。朗读检查文本清理、多个消息竞争、停止事件、AbortSignal 和自动播放限制；本页未调用上游 ASR 或 TTS 服务，也未验证真实设备音质。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts:L1–L186](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/useTaskAsr.ts#L1-L186)；
  - [jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts:L1–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskAsr/featureFlag.ts#L1-L21)；
  - [jiuwenswarm/channels/web/frontend/src/utils/tts.ts:L1–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/tts.ts#L1-L139)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts:L1–L392](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts#L1-L392)；
  - [jiuwenswarm/channels/web/frontend/README.md:L1–L284](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/README.md#L1-L284)。
- 关联阅读：[[feature-web-chat-1]]、[[feature-web-chat-2]]（web-chat）；[[feature-multimodal]]（multimodal）；[[feature-video-duplex]]（video-duplex）。
