---
name: components-teammemberavatar-contracts-01
description: components-teammemberavatar 源码接口 01：TeamMemberAvatar/index.tsx 一个文件的声明（TeamMemberIdentity、TeamMemberAvatarProps、useTeamMemberIdentity、TeamMemberAvatar）、导入依赖（clsx、react、chatStore、sessionStore）与源码行区间
metadata:
  scope: 只收 TeamMemberAvatar/index.tsx 的接口记录；目录入口归 components-teammemberavatar-overview
---
# components-teammemberavatar 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/TeamMemberAvatar/index.tsx`**
- 源码声明的类型、组件或调用边界：`TeamMemberIdentity`, `TeamMemberAvatarProps`, `useTeamMemberIdentity`, `activeSessionId`, `teamMembers`, `id`, `known`, `TeamMemberAvatar`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import clsx from 'clsx';`；`import { useMemo } from 'react';`；`import { useChatStore } from '../../stores/chatStore';`；`import { useSessionStore } from '../../stores/sessionStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/TeamMemberAvatar/index.tsx#L1-L71)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-teammemberavatar/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
