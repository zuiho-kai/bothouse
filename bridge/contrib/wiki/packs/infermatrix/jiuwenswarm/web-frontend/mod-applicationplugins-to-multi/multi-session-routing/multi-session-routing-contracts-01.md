---
name: multi-session-routing-contracts-01
description: multi-session-routing 源码接口 01：multi-session/routing 下 route.ts（ChatRoute、parseChatRoute、chatRoutePath）与 useChatRoute.ts 两个文件的声明与导入依赖
metadata:
  scope: 只收这两个文件的接口记录；目录入口归 multi-session-routing-overview
---
# multi-session-routing 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/routing/route.ts`**
- 源码声明的类型、组件或调用边界：`ChatRoute`, `parseChatRoute`, `path`, `match`, `sessionId`, `chatRoutePath`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/routing/route.ts#L1-L19)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/routing/useChatRoute.ts`**
- 源码声明的类型、组件或调用边界：`ChatRoute`, `useChatRoute`, `onPopState`, `navigate`, `method`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useState } from 'react';`；`import { chatRoutePath, parseChatRoute, type ChatRoute } from './route';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/routing/useChatRoute.ts#L1-L17)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/multi-session-routing/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
