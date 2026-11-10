---
name: components-goalbar-contracts-01
description: components-goalbar 源码接口与集成边界 01：web/frontend/src/components/GoalBar 下 EditGoalModal.tsx、GoalCompletedCard.tsx、OverwriteGoalConfirmModal.tsx、goalCompletedMessage.ts、index.tsx 共 5 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 5 个前端文件的静态声明，不证明运行行为；入口说明归 components-goalbar-overview
---
# components-goalbar 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/GoalBar/EditGoalModal.tsx`**
- 源码声明的类型、组件或调用边界：`EditGoalModalProps`, `EditGoalModal`, `canSave`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；`import { Target, X } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/GoalBar/EditGoalModal.tsx#L1-L73)。
- **`jiuwenswarm/channels/web/frontend/src/components/GoalBar/GoalCompletedCard.tsx`**
- 源码声明的类型、组件或调用边界：`GoalCompletedCardProps`, `GoalCompletedCard`, `data`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Target } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { parseGoalCompletedContent } from './goalCompletedMessage';`；`import './GoalBar.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/GoalBar/GoalCompletedCard.tsx#L1-L35)。
- **`jiuwenswarm/channels/web/frontend/src/components/GoalBar/OverwriteGoalConfirmModal.tsx`**
- 源码声明的类型、组件或调用边界：`OverwriteGoalConfirmModalProps`, `OverwriteGoalConfirmModal`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；`import { Target, X } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/GoalBar/OverwriteGoalConfirmModal.tsx#L1-L85)。
- **`jiuwenswarm/channels/web/frontend/src/components/GoalBar/goalCompletedMessage.ts`**
- 源码声明的类型、组件或调用边界：`GOAL_COMPLETED_PREFIX`, `GoalCompletedData`, `buildGoalCompletedContent`, `isGoalCompletedContent`, `parseGoalCompletedContent`, `raw`, `parsed`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/GoalBar/goalCompletedMessage.ts#L1-L33)。
- **`jiuwenswarm/channels/web/frontend/src/components/GoalBar/index.tsx`**
- 源码声明的类型、组件或调用边界：`GoalBarProps`, `DisplayTone`, `STATUS_TONE`, `formatSeconds`, `seconds`, `minutes`, `remainSeconds`, `formatElapsedFallback`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Pause, Pencil, Play, Target, Trash2 } from 'lucide-react';`；`import { useChatStore, useGoalStore, useSessionStore } from '../../stores';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/GoalBar/index.tsx#L1-L247)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-goalbar/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
