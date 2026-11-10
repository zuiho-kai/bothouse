---
name: components-root-contracts-01
description: components-root 源码接口与集成边界 01：web/frontend/src/components 下 ExternalCliAgentsSection.tsx、ExternalCliInstallDialog.tsx、TeamTaskEvents.tsx 共 3 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 3 个前端文件的静态声明，不证明运行行为；入口说明归 components-root-overview
---
# components-root 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ExternalCliAgentsSection.tsx`**
- 源码声明的类型、组件或调用边界：`ExternalCliAgentKind`, `ExternalCliDetectResult`, `ExternalCliDependencyInstallStatus`, `ExternalCliConfigSaveResult`, `ExternalCliPendingChoice`, `EXTERNAL_CLI_AGENT_KINDS`, `EXTERNAL_CLI_AUTO_DETECT_DELAY_MS`, `EXTERNAL_CLI_AGENT_CONFIG_KEYS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef, useState } from 'react';`；`import { AlertCircle, Check, CheckCircle2, Copy, FileSearch, Loader2, RefreshCw } from 'lucide-react`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ExternalCliAgentsSection.tsx#L1-L539)。
- **`jiuwenswarm/channels/web/frontend/src/components/ExternalCliInstallDialog.tsx`**
- 源码声明的类型、组件或调用边界：`InstallStatuses`, `formatBytes`, `units`, `amount`, `unitIndex`, `digits`, `formatEta`, `rounded`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect } from 'react';`；`import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import type { ExternalCliAgentKind, ExternalCliDependencyInstallStatus } from './ExternalCliAgentsSe`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ExternalCliInstallDialog.tsx#L1-L192)。
- **`jiuwenswarm/channels/web/frontend/src/components/TeamTaskEvents.tsx`**
- 源码声明的类型、组件或调用边界：`TeamTaskEvent`, `TeamTaskEventsProps`, `TeamTaskEvents`, `formatTime`, `date`, `getEventName`, `match`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/TeamTaskEvents.tsx#L1-L55)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-root/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
