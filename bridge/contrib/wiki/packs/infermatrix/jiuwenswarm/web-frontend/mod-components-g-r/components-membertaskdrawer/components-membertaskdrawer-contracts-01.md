---
name: components-membertaskdrawer-contracts-01
description: components-membertaskdrawer 源码接口与集成边界 01：web/frontend/src/components/MemberTaskDrawer 下 index.tsx 共 1 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 1 个前端文件的静态声明，不证明运行行为；入口说明归 components-membertaskdrawer-overview
---
# components-membertaskdrawer 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/MemberTaskDrawer/index.tsx`**
- 源码声明的类型、组件或调用边界：`MemberTaskDrawerProps`, `getMemberRole`, `roles`, `key`, `ChevronIcon`, `TaskStatusIcon`, `CollapsibleTaskGroupProps`, `CollapsibleTaskGroup`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState, useMemo } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { useChatStore, useTodoStore, useSessionStore } from '../../stores';`；`import { TeamMemberAvatar } from '../TeamMemberAvatar';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MemberTaskDrawer/index.tsx#L1-L289)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-membertaskdrawer/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
