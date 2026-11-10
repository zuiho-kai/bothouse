---
name: components-teamarea-contracts-02
description: components-teamarea 源码接口 02：teamArea 目录下 UnassignedTeamAvatar.tsx、index.tsx（useTaskPlanningMetrics）、shared.tsx、taskProgress.ts（RUNNING_PROGRESS_* 常量）、workflowTypes.ts 五个文件的声明、导入依赖与源码行区间
metadata:
  scope: 只收这五个文件的接口记录；AgentDetailModal 等十二个组件文件归 components-teamarea-contracts-01，目录入口归 components-teamarea-overview
---
# components-teamarea 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/UnassignedTeamAvatar.tsx`**
- 源码声明的类型、组件或调用边界：`UnassignedTeamAvatar`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/UnassignedTeamAvatar.tsx#L1-L16)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/index.tsx`**
- 源码声明的类型、组件或调用边界：`useTaskPlanningMetrics`, `activeSessionId`, `todos`, `teamTaskEvents`, `teamTasks`, `taskProgressBaseline`, `progressTasks`, `timer`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, useState } from 'react';`；`import { useChatStore, useSessionStore, useTodoStore } from '../../stores';`；`import { normalizeTaskStatus } from './shared';`；`import { getTasksForCurrentProgress } from '../../features/teamTaskProgressBaseline';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/index.tsx#L1-L54)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/shared.tsx`**
- 源码声明的类型、组件或调用边界：`Translate`, `TeamMember`, `TeamTaskEvent`, `MemberTask`, `ProcessDetailRow`, `ProcessItem`, `BaseTeamAreaProps`, `TeamAreaProps`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { ChevronRight, Circle } from 'lucide-react';`；`import CheckIcon from '../../assets/work-mode/check.svg?react';`；`import i18n from '../../i18n';`；`import { ParsedTeamEvent, parseTeamEventMessage } from '../ChatPanel/teamEventUtils';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/shared.tsx#L1-L590)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/taskProgress.ts`**
- 源码声明的类型、组件或调用边界：`RUNNING_PROGRESS_INITIAL`, `RUNNING_PROGRESS_CAP`, `RUNNING_PROGRESS_EASING_MS`, `getTaskStartTime`, `getTaskVisualProgressPercent`, `clock`, `elapsedMs`, `eased`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TeamTask } from '../../stores/sessionStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/taskProgress.ts#L1-L58)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/workflowTypes.ts`**
- 源码声明的类型、组件或调用边界：`WorkflowStatus`, `WorkflowNodeType`, `WorkflowAgentActivity`, `WorkflowBudget`, `compactTokenLabel`, `k`, `m`, `formatBudgetK`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/workflowTypes.ts#L1-L971)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-teamarea/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
