---
name: video-duplex-frontend-contracts-01
description: video-duplex-frontend 源码接口与集成边界 01：frontend 的 TaskFullDuplexAction、TaskFullDuplexRuntime、VideoDuplexSettings 与 VideoLivePanel 下的 duplex-capture、duplex-playback、index、joyai*、qwenOmni* 文件声明
metadata:
  scope: 只收 description 所列十三个前端文件的静态声明；VideoLivePanel 的 replyLanguage、searchPresentation、taskPrompts、types、videoSource 及 frontend 根目录的 index.tsx、taskDuplexJobs、taskFullDuplexRuntimeStore 归 video-duplex-frontend-contracts-02，入口说明归 video-duplex-frontend-overview
---
# video-duplex-frontend 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/extensions/video_duplex/frontend/TaskFullDuplexAction.tsx`**
- 源码声明的类型、组件或调用边界：`parseEnabled`, `TaskFullDuplexAction`, `enabled`, `cancelled`, `retryTimer`, `load`, `handleClick`, `readySessionId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect } from 'react';`；`import { AudioWaveform, LoaderCircle, Square } from 'lucide-react';`；`import type { ApplicationPluginTaskInputActionProps } from '../../../channels/web/frontend/src/appli`；
  - `import { useTaskFullDuplexEnabled, setTaskFullDuplexEnabled } from '../../../channels/web/frontend/s`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/TaskFullDuplexAction.tsx#L1-L96)。
- **`jiuwenswarm/extensions/video_duplex/frontend/TaskFullDuplexRuntime.tsx`**
- 源码声明的类型、组件或调用边界：`VideoLivePanelHandle`, `WAIT_REASON_LABELS`, `PersistedTimelineEvent`, `historyQueues`, `timelineEventId`, `timestampSeconds`, `parsed`, `persistTimelineEvent`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef } from "react";`；`import type { ApplicationPluginTaskRuntimeProps } from "../../../channels/web/frontend/src/applicati`；`import { useTaskFullDuplexEnabled } from "../../../channels/web/frontend/src/features/taskFullDuplex`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/TaskFullDuplexRuntime.tsx#L1-L599)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoDuplexSettings.tsx`**
- 源码声明的类型、组件或调用边界：`Provider`, `VoiceProtocol`, `SettingsValues`, `SettingsPayload`, `EMPTY_SETTINGS`, `SECRET_KEYS`, `secretPlaceholder`, `VideoDuplexSettingsProps`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { FormEvent, useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { LoaderCircle, Power, Save, Settings2 } from 'lucide-react';`；`import type { ApplicationPluginSettingsProps } from '../../../channels/web/frontend/src/applicationP`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoDuplexSettings.tsx#L1-L252)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/duplex-capture.js`**
- 源码声明的类型、组件或调用边界：`DuplexCaptureProcessor`, `channel`, `index`, `sample`, `ready`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/duplex-capture.js#L1-L25)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/duplex-playback.js`**
- 源码声明的类型、组件或调用边界：`DuplexPlaybackProcessor`, `wasEmpty`, `output`, `target`, `chunk`, `count`, `remainingBeforeChunk`, `index`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/duplex-playback.js#L1-L156)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/index.tsx`**
- 源码声明的类型、组件或调用边界：`VideoSource`, `CapturedFrame`, `ScreenSource`, `FRAME_INTERVAL_MS`, `MAX_FRAMES`, `MAX_SCREENS`, `MAX_FRAME_WIDTH`, `SCREEN_PREVIEW_FRAME_RATE`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { TASK_ACCEPTED_INSTRUCTIONS } from './taskPrompts';`；`import {`；`import {`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/index.tsx#L1-L1434)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiPromptLifecycle.ts`**
- 源码声明的类型、组件或调用边界：`ClaimedJoyAIPrompt`, `PromptWaiter`, `PendingJoyAIPrompt`, `JoyAIPromptLifecycle`, `waiter`, `pending`, `settled`, `pending`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiPromptLifecycle.ts#L1-L84)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiProvider.ts`**
- 源码声明的类型、组件或调用边界：`ReplyLanguage`, `FRAME_POLL_INTERVAL_MS`, `RATE_LIMIT_BASE_COOLDOWN_MS`, `RATE_LIMIT_MAX_COOLDOWN_MS`, `FRAME_POLL_CLIENT_BUILD`, `isJoyAIRateLimit`, `candidate`, `message`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { normalizeReplyLanguage, type ReplyLanguage } from './replyLanguage';`；`import { webClient, webRequest } from '../../../../channels/web/frontend/src/services/webClient';`；`import { canPlayJoyAIResponse, JoyAITtsInterruptionState, JoyAIVoiceSession } from './joyaiVoice';`；
  - `import { assistantSpeechText } from './searchPresentation';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiProvider.ts#L1-L583)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiToolContext.ts`**
- 源码声明的类型、组件或调用边界：`JoyAIToolContextEntry`, `JoyAIToolContextBatch`, `MAX_PENDING_TOOL_RESULTS`, `MAX_ATTACHED_TOOL_RESULTS`, `MAX_TOOL_CONTEXT_CHARS`, `compact`, `normalized`, `rememberJoyAIToolContext`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiToolContext.ts#L1-L69)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiVoice.ts`**
- 源码声明的类型、组件或调用边界：`TARGET_RATE`, `PRE_ROLL_MS`, `MAX_TURN_MS`, `PCM_STREAM_START_BUFFER_MS`, `JoyAIVoiceCallbacks`, `readableError`, `canPlayJoyAIResponse`, `JoyAITtsInterruptionState`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SileroVad, SpeechDetection } from '../../../../channels/web/frontend/src/utils/speechD`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/joyaiVoice.ts#L1-L444)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/qwenOmniProtocol.ts`**
- 源码声明的类型、组件或调用边界：`QWEN_MAX_BASE64_IMAGE_BYTES`, `QWEN_SESSION_INSTRUCTIONS`, `QwenOmniSessionOptions`, `QwenOmniMediaBatch`, `QwenOmniMediaSnapshot`, `createQwenOmniSessionUpdate`, `createQwenOmniTextTurnEvents`, `createQwenOmniToolResultEvents`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { normalizeReplyLanguage, speakLanguageInstruction } from './replyLanguage.js';`；`import {`；`import type { RealtimeBrief } from './types.js';`；`import type { QwenOmniToolResultContext } from './qwenOmniTools.js';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/qwenOmniProtocol.ts#L1-L159)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/qwenOmniSession.ts`**
- 源码声明的类型、组件或调用边界：`RealtimeDuplexConfig`, `RealtimeToolResult`, `RealtimeDuplexCallbacks`, `resolveRealtimeUrl`, `protocol`, `browserBase`, `base`, `createRealtimeDuplexSession`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { taskCancellationNotice, taskQuestionNotice } from './taskPrompts.js';`；`import {`；`import { getWsBase } from '../../../../channels/web/frontend/src/utils/env.js';`；`import type { RealtimeBrief } from './types.js';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/qwenOmniSession.ts#L1-L1022)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/qwenOmniTools.ts`**
- 源码声明的类型、组件或调用边界：`QWEN_OMNI_DELEGATE_TOOL_NAME`, `QWEN_OMNI_LEGACY_RESEARCH_TOOL_NAME`, `QwenOmniFunctionCall`, `QWEN_OMNI_DELEGATE_ARGUMENT_NAMES`, `asRecord`, `parseQwenOmniFunctionCall`, `name`, `callId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { TASK_OPERATION_INSTRUCTIONS, taskResultNotice } from './taskPrompts.js';`；`import type { RealtimeBrief } from './types.js';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/qwenOmniTools.ts#L1-L142)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/video-duplex-frontend/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
