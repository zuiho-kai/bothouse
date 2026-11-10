---
name: components-toolpanel-contracts-01
description: components-toolpanel 源码接口 01：ToolPanel 目录下 CollapsibleSection.tsx、ReadOnlyFileModal.tsx、index.tsx（TabType、SingleAgentToolTab、todoItemToTeamTask）三个文件的声明、导入依赖与源码行区间
metadata:
  scope: 只收这三个文件的接口记录；目录入口归 components-toolpanel-overview
---
# components-toolpanel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ToolPanel/CollapsibleSection.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `CollapsibleSectionProps`, `CollapsibleSection`, `expanded`, `handleToggleCollapse`, `nextCollapsed`, `handleExpandAll`, `overflowCount`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState, type ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Maximize2 } from 'lucide-react';`；`import collapseIcon from '../../assets/work-mode/collapse.svg';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ToolPanel/CollapsibleSection.tsx#L1-L149)。
- **`jiuwenswarm/channels/web/frontend/src/components/ToolPanel/ReadOnlyFileModal.tsx`**
- 源码声明的类型、组件或调用边界：`ReadOnlyFileModalProps`, `isPreviewableFile`, `lowerName`, `isMarkdownFile`, `lowerName`, `isJsonFile`, `ReadOnlyFileModal`, `handleKeyDown`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import ReactMarkdown from 'react-markdown';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ToolPanel/ReadOnlyFileModal.tsx#L1-L218)。
- **`jiuwenswarm/channels/web/frontend/src/components/ToolPanel/index.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `TabType`, `SingleAgentToolTab`, `todoItemToTeamTask`, `statusMap`, `ts`, `ToolPanelProps`, `isEmptyValue`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import { useChatStore, useSessionStore, useTodoStore } from '../../stores';`；`import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';`；`import { Info } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ToolPanel/index.tsx#L1-L789)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-toolpanel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
