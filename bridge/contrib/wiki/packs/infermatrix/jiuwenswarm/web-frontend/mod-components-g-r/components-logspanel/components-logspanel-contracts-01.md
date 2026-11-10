---
name: components-logspanel-contracts-01
description: components-logspanel 源码接口与集成边界 01：web/frontend/src/components/LogsPanel 下 index.tsx 共 1 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 1 个前端文件的静态声明，不证明运行行为；入口说明归 components-logspanel-overview
---
# components-logspanel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx`**
- 源码声明的类型、组件或调用边界：`LogsPanelProps`, `WS_RECONNECT_EVENT`, `formatLogEntries`, `parseJsonlTail`, `lines`, `isDebugLogEntry`, `record`, `LogsPanel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx#L1-L221)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-logspanel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
