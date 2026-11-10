---
name: config-contracts-01
description: config 源码接口 01：config/chatConfig.tsx（AGENT_MODE_OPTIONS、PERMISSION_OPTIONS 等）与 config/permissionProfiles.ts（permissionOptionsForMode、effectivePermissionProfile）两个文件的声明与依赖
metadata:
  scope: 只收这两个文件的接口记录；目录入口归 config-overview
---
# config 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/config/chatConfig.tsx`**
- 源码声明的类型、组件或调用边界：`ChatOptionDef`, `ClusterModeIcon`, `SingleAgentModeIcon`, `DefaultPermissionIcon`, `SafeAccessPermissionIcon`, `AGENT_MODE_OPTIONS`, `PERMISSION_OPTIONS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { CircleAlert } from 'lucide-react';`；`import type { AgentMode, Permission } from '../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/config/chatConfig.tsx#L1-L63)。
- **`jiuwenswarm/channels/web/frontend/src/config/permissionProfiles.ts`**
- 源码声明的类型、组件或调用边界：`PERMISSION_OPTIONS`, `permissionOptionsForMode`, `effectivePermissionProfile`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AgentMode, Permission } from '../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/config/permissionProfiles.ts#L1-L12)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/config/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
