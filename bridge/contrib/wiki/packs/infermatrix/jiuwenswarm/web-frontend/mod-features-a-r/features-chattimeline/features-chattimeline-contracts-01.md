---
name: features-chattimeline-contracts-01
description: features-chattimeline 源码接口 01：src/features/chatTimeline 下 buildTurnTimeline（消息渲染键、TimelineItem/RenderItem、时间戳与输出顺序）、index、projectTimelineItems 三个文件的声明与导入依赖
metadata:
  scope: 只收这三个文件的静态声明记录，不证明运行行为；目录入口归 features-chattimeline-overview
---
# features-chattimeline 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/chatTimeline/buildTurnTimeline.ts`**
- 源码声明的类型、组件或调用边界：`legacyMessageKeyCache`, `legacyMessageKeyCounter`, `getMessageRenderKey`, `key`, `TimelineItem`, `RenderItem`, `toTimestampMs`, `getTimelineOutputOrder`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Message, OutputOrder, ToolExecution } from '../../types';`；`import type { ReasoningSegment } from '../../stores/chatStore';`；`import { getMessageActor } from '../../components/ChatPanel/MessageItem';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/chatTimeline/buildTurnTimeline.ts#L1-L1149)。
- **`jiuwenswarm/channels/web/frontend/src/features/chatTimeline/index.ts`**
- 源码声明的类型、组件或调用边界：`TimelineItem`, `RenderItem`, `TurnWorkMeta`, `LiveWorkStreak`, `WorkOutcomeTone`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/chatTimeline/index.ts#L1-L26)。
- **`jiuwenswarm/channels/web/frontend/src/features/chatTimeline/projectTimelineItems.ts`**
- 源码声明的类型、组件或调用边界：`projectTimelineItems`, `turnKeys`, `streakByItemKey`, `item`, `streak`, `key`, `meta`, `turnKey`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { RenderItem, LiveWorkStreak, TurnWorkMeta } from './buildTurnTimeline';`；`import { filterDeliverableExecutions } from './buildTurnTimeline';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/chatTimeline/projectTimelineItems.ts#L1-L59)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-chattimeline/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
