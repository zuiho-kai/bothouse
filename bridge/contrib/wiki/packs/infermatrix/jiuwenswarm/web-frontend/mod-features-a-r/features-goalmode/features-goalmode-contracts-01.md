---
name: features-goalmode-contracts-01
description: features-goalmode 源码接口 01：src/features/goalMode/goalModeGate.ts 一个文件的声明（GoalArmBlockReason、GoalArmDecision、未完成目标与会话忙判断函数）与导入依赖
metadata:
  scope: 只收 goalModeGate.ts 一个文件的静态声明记录，不证明运行行为；目录入口归 features-goalmode-overview
---
# features-goalmode 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts`**
- 源码声明的类型、组件或调用边界：`GoalArmBlockReason`, `GoalArmDecision`, `sessionHasUnfinishedGoal`, `goal`, `isGoalStatusActive`, `hasPendingGoalAction`, `isGoalSessionBusy`, `isPlanCommittedForSession`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useGoalStore } from '../../stores/goalStore';`；`import { usePlanStore } from '../../stores/planStore';`；`import { hasUnfinishedGoal } from '../../components/ChatPanel/slashCommands/semantics';`；
  - `import { isSessionBusyForPlanToggle as isSessionBusyForModeToggle } from '../planMode/planModeGate';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L1-L220)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-goalmode/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
