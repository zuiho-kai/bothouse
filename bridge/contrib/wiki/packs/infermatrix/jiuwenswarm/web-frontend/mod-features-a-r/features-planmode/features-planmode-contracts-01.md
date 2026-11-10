---
name: features-planmode-contracts-01
description: features-planmode 源码接口与集成边界 01：web/frontend/src/features/planMode 下 planEntrySource.ts、planModeGate.ts、wireMode.ts 三个前端文件的静态声明（PLAN_ENTRY_SOURCES、evaluatePlanToggle、resolvePlanWireMode 等）与导入
metadata:
  scope: 收 features/planMode 全部三个文件的静态声明，不证明控制流或运行行为；入口说明归 features-planmode-overview
---
# features-planmode 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/planMode/planEntrySource.ts`**
- 源码声明的类型、组件或调用边界：`PLAN_ENTRY_SOURCE_PLAN_TOGGLE`, `PLAN_ENTRY_SOURCE_SLASH_COMMAND`, `PLAN_ENTRY_SOURCES`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planEntrySource.ts#L1-L43)。
- **`jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts`**
- 源码声明的类型、组件或调用边界：`PlanToggleBlockReason`, `PlanToggleDecision`, `isSessionBusyForPlanToggle`, `runtime`, `sessionHasUnfinishedGoal`, `goal`, `evaluatePlanToggle`, `busy`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useChatStore } from '../../stores/chatStore';`；`import { useGoalStore } from '../../stores/goalStore';`；`import { usePlanStore } from '../../stores/planStore';`；`import { hasUnfinishedGoal } from '../../components/ChatPanel/slashCommands/semantics';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L1-L137)。
- **`jiuwenswarm/channels/web/frontend/src/features/planMode/wireMode.ts`**
- 源码声明的类型、组件或调用边界：`PlanBaseMode`, `PlanWorkProfile`, `supportsPlanMode`, `isTeamAgentMode`, `normalized`, `resolvePlanWireMode`, `base`, `env`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/wireMode.ts#L1-L106)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-planmode/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
