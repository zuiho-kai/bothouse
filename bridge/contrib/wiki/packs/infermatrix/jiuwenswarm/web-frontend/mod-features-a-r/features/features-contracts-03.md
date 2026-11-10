---
name: features-contracts-03
description: features 源码接口 03：web 前端 src/features 目录下 teamPanelState.ts（TeamPanelState、存储键与事件常量、load/save/notify/openTeamPanel）与 teamTaskProgressBaseline.ts（TaskProgressBaseline 及其创建、合并、过滤函数）两个文件的声明与导入依赖
metadata:
  scope: 只收 teamPanelState 与 teamTaskProgressBaseline 两个文件的静态声明记录，不证明运行行为；其余 features 文件归 features-contracts-01、features-contracts-02，入口说明归 features-overview
---
# features 源码接口与集成边界 03

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/teamPanelState.ts`**
- 源码声明的类型、组件或调用边界：`TeamPanelState`, `TEAM_PANEL_STATE_KEY`, `TEAM_PANEL_STATE_EVENT`, `UseTeamPanelStateResult`, `loadTeamPanelState`, `saveTeamPanelState`, `notifyTeamPanelState`, `openTeamPanel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useState } from 'react';`；`import type { TabType, TeamDetailTab } from '../components/teamArea/shared';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/teamPanelState.ts#L1-L132)。
- **`jiuwenswarm/channels/web/frontend/src/features/teamTaskProgressBaseline.ts`**
- 源码声明的类型、组件或调用边界：`TaskProgressBaseline`, `createTaskProgressBaseline`, `registerConfirmedTaskCreation`, `mergeTaskProgressBaseline`, `getTasksForCurrentProgress`, `excludedTaskIds`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TeamTask } from '../stores/sessionStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/teamTaskProgressBaseline.ts#L1-L39)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features/source-contracts-03.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
