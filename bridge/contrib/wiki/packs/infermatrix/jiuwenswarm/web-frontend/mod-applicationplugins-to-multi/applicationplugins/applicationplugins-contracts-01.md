---
name: applicationplugins-contracts-01
description: applicationplugins 源码接口 01：applicationPlugins 目录下 ApplicationPluginOutlet.tsx、ApplicationTaskControls.tsx、manifest.ts、taskProgressStore.ts、types.ts、useApplicationPlugins.ts 六个文件的声明与导入依赖
metadata:
  scope: 只收这六个文件的接口记录；目录入口归 applicationplugins-overview
---
# applicationplugins 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/applicationPlugins/ApplicationPluginOutlet.tsx`**
- 源码声明的类型、组件或调用边界：`BundledPluginModule`, `bundledModules`, `bundledComponents`, `bundledSettingsComponents`, `bundledTaskInputActions`, `bundledTaskRuntimes`, `module`, `applicationPluginSettingsComponent`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ComponentType } from 'react';`；`import type {`；`import './applicationPlugins.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/applicationPlugins/ApplicationPluginOutlet.tsx#L1-L82)。
- **`jiuwenswarm/channels/web/frontend/src/applicationPlugins/ApplicationTaskControls.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `ApplicationTaskAction`, `DRAG_TYPE`, `ApplicationTaskControls`, `sessions`, `tasks`, `task`, `pending`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState, type ReactNode } from 'react';`；`import { ArrowUpToLine, GripVertical, MoreHorizontal, X } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；
  - `import { controlApplicationTask, useApplicationTaskStore, type ApplicationTaskAction } from './taskP`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/applicationPlugins/ApplicationTaskControls.tsx#L1-L157)。
- **`jiuwenswarm/channels/web/frontend/src/applicationPlugins/manifest.ts`**
- 源码声明的类型、组件或调用边界：`isContribution`, `item`, `normalizeApplicationPluginManifest`, `manifest`, `enabledApplicationPlugins`, `fetchApplicationPlugins`, `response`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ApplicationPluginContribution, ApplicationPluginManifest } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/applicationPlugins/manifest.ts#L1-L36)。
- **`jiuwenswarm/channels/web/frontend/src/applicationPlugins/taskProgressStore.ts`**
- 源码声明的类型、组件或调用边界：`ApplicationTaskStatus`, `ApplicationTaskAction`, `TaskController`, `controllers`, `registerApplicationTaskController`, `controlApplicationTask`, `controller`, `ApplicationTaskProgress`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { create } from 'zustand';`；`import type { TeamTask } from '../stores/sessionStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/applicationPlugins/taskProgressStore.ts#L1-L111)。
- **`jiuwenswarm/channels/web/frontend/src/applicationPlugins/types.ts`**
- 源码声明的类型、组件或调用边界：`ApplicationPluginNavKey`, `ApplicationPluginContribution`, `ApplicationPluginManifest`, `ApplicationPluginSettingsProps`, `ApplicationPluginTaskInputActionProps`, `ApplicationPluginTaskRuntimeProps`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import type { FileDownloadItem, ToolCall, ToolResult } from '../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/applicationPlugins/types.ts#L1-L58)。
- **`jiuwenswarm/channels/web/frontend/src/applicationPlugins/useApplicationPlugins.ts`**
- 源码声明的类型、组件或调用边界：`ApplicationPluginsState`, `useApplicationPlugins`, `refresh`, `controller`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useState } from 'react';`；`import { fetchApplicationPlugins } from './manifest';`；`import type { ApplicationPluginContribution } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/applicationPlugins/useApplicationPlugins.ts#L1-L59)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/applicationplugins/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
