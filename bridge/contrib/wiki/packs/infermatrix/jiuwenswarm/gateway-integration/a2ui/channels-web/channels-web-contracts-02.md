---
name: channels-web-contracts-02
description: channels-web 源码接口与集成边界 02：web/frontend/src/features/a2ui 下 formDefaults.ts 与 rendererRegistry.tsx 两个前端文件的静态声明
metadata:
  scope: 只收 formDefaults 与 rendererRegistry 的静态声明，不证明运行行为；其余前端文件归 channels-web-contracts-01，入口说明归 channels-web-overview
---
# channels-web 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/formDefaults.ts`**
- 源码声明的类型、组件或调用边界：`UnknownRecord`, `isDevA2UIDiagnosticEnabled`, `a2uiDebug`, `a2uiWarn`, `a2uiError`, `isRecord`, `normalizeA2UIPath`, `trimmed`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { DataValue } from '@a2ui/react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/formDefaults.ts#L1-L219)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/rendererRegistry.tsx`**
- 源码声明的类型、组件或调用边界：`A2UIProtocolVersion`, `A2UIRendererProps`, `a2uiV08Registry`, `applyOverrides`, `_overridesApplied`, `A2UIV08Renderer`, `current`, `rendererByVersion`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ComponentType } from 'react';`；`import { A2UIRenderer, ComponentRegistry } from '@a2ui/react';`；`import { A2UI_PROTOCOL_VERSION, type A2UIProtocolVersion } from './a2uiContent';`；`import { CheckBoxWithDefaults } from './CheckBoxWithDefaults';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/rendererRegistry.tsx#L1-L72)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/a2ui/channels-web/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
