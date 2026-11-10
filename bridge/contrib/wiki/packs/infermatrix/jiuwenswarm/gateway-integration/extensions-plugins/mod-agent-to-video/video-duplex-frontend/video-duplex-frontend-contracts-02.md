---
name: video-duplex-frontend-contracts-02
description: video-duplex-frontend 源码接口与集成边界 02：frontend 的 VideoLivePanel/replyLanguage、searchPresentation、taskPrompts、types、videoSource 与根目录 index.tsx、taskDuplexJobs、taskFullDuplexRuntimeStore 声明
metadata:
  scope: 只收 description 所列八个前端文件的静态声明；其余前端文件归 video-duplex-frontend-contracts-01，入口说明归 video-duplex-frontend-overview
---
# video-duplex-frontend 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/replyLanguage.ts`**
- 源码声明的类型、组件或调用边界：`ReplyLanguage`, `normalizeReplyLanguage`, `speakLanguageInstruction`, `preserve`, `announceLanguageInstruction`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/replyLanguage.ts#L1-L9)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/searchPresentation.ts`**
- 源码声明的类型、组件或调用边界：`cleanModelText`, `SearchStatusItem`, `searchAwareToolStatus`, `foreground`, `runningCount`, `background`, `assistantSpeechText`, `normalized`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SearchJobPayload, SearchProgressJob } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/searchPresentation.ts#L1-L106)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/taskPrompts.ts`**
- 源码声明的类型、组件或调用边界：`QWEN_OMNI_TOOL_INSTRUCTIONS`, `TASK_ACCEPTED_INSTRUCTIONS`, `TASK_OPERATION_INSTRUCTIONS`, `taskCancellationNotice`, `taskQuestionNotice`, `taskResultNotice`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { RealtimeBrief } from './types.js';`；`import { announceLanguageInstruction, normalizeReplyLanguage } from './replyLanguage.js';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/taskPrompts.ts#L1-L59)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/types.ts`**
- 源码声明的类型、组件或调用边界：`ChatContextItem`, `RealtimeBrief`, `SearchJobPayload`, `SearchProgressEntry`, `SearchProgressJob`, `SearchJobState`, `AgentAction`, `VideoSessionConfig`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { FileDownloadItem } from '../../../../channels/web/frontend/src/types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/types.ts#L1-L120)。
- **`jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/videoSource.ts`**
- 源码声明的类型、组件或调用边界：`RealtimeVideoFrame`, `RealtimeVideoFrameScheduler`, `latestBySource`, `latest`, `offset`, `index`, `frame`, `RealtimeVideoSource`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/VideoLivePanel/videoSource.ts#L1-L89)。
- **`jiuwenswarm/extensions/video_duplex/frontend/index.tsx`**
- 源码声明的类型、组件或调用边界：`applicationPluginId`, `applicationPluginTaskInputAction`, `applicationPluginTaskRuntime`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { VideoLivePanel } from "./VideoLivePanel";`；`import { TaskFullDuplexAction } from "./TaskFullDuplexAction";`；`import { TaskFullDuplexRuntime } from "./TaskFullDuplexRuntime";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/index.tsx#L1-L8)。
- **`jiuwenswarm/extensions/video_duplex/frontend/taskDuplexJobs.ts`**
- 源码声明的类型、组件或调用边界：`ConversationJob`, `TaskDuplexJobs`, `searchSessionId`, `jobId`, `searchSessionId`, `sessionId`, `previous`, `job`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SearchJobPayload } from "./VideoLivePanel/types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/taskDuplexJobs.ts#L1-L86)。
- **`jiuwenswarm/extensions/video_duplex/frontend/taskFullDuplexRuntimeStore.ts`**
- 源码声明的类型、组件或调用边界：`TaskFullDuplexRuntimeState`, `TaskFullDuplexRuntimeSnapshot`, `controller`, `bindSession`, `snapshot`, `listeners`, `errorToast`, `publish`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useSyncExternalStore } from 'react';`；`import { toast } from '../../../channels/web/frontend/src/components/ui/Toast/toastStore';`；`import type { VideoLivePanelHandle } from './VideoLivePanel';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/frontend/taskFullDuplexRuntimeStore.ts#L1-L78)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/video-duplex-frontend/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
