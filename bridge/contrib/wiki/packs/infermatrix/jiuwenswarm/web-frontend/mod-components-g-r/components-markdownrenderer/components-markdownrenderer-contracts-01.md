---
name: components-markdownrenderer-contracts-01
description: components-markdownrenderer 源码接口与集成边界 01：web/frontend/src/components 下 MarkdownRenderer/MarkdownRenderer.tsx、MarkdownRenderer/codeBlocks/fencedCode.ts、MarkdownRenderer/codeBlocks/registry.tsx、MarkdownRenderer/codeBlocks/types.ts、MarkdownRenderer/diagrams/DiagramViewer.tsx、MarkdownRenderer/diagrams/MermaidDiagram.tsx、MarkdownRenderer/diagrams/SvgDiagram.tsx、MarkdownRenderer/diagrams/diagramExport.ts、MarkdownRenderer/diagrams/mermaidLayout.ts、MarkdownRenderer/diagrams/mermaidRuntime.ts、MarkdownRenderer/diagrams/svgPreview.ts、MarkdownRenderer/diagrams/useDiagramExportActions.ts、MarkdownRenderer/isolatedPreview.ts 共 13 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 13 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-markdownrenderer-contracts-02；入口说明归 components-markdownrenderer-overview
---
# components-markdownrenderer 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/MarkdownRenderer.tsx`**
- 源码声明的类型、组件或调用边界：`AnchorHTMLAttributes`, `MarkdownRendererProps`, `MarkdownContentLinesContext`, `MarkdownStreamingContext`, `MermaidCanvasMinHeightContext`, `MarkdownIncludeMathMLContext`, `MarkdownLinkClickContext`, `MarkdownLink`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createContext, useContext, useMemo, type AnchorHTMLAttributes, type HTMLAttributes } from '`；`import ReactMarkdown from 'react-markdown';`；`import type { Element as HastElement } from 'hast';`；`import { unescapeLiteralNewlines } from '../../utils/finalContent';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/MarkdownRenderer.tsx#L1-L121)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/codeBlocks/fencedCode.ts`**
- 源码声明的类型、组件或调用边界：`HTMLAttributes`, `MarkdownPositionPoint`, `PositionedMarkdownNode`, `getCodeElement`, `childArray`, `child`, `getCodeLanguage`, `languageClass`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Children, isValidElement, type HTMLAttributes, type ReactElement, type ReactNode } from 're`；`import type { FencedCodeBlock } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/codeBlocks/fencedCode.ts#L1-L61)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/codeBlocks/registry.tsx`**
- 源码声明的类型、组件或调用边界：`MermaidCodeBlock`, `FENCED_CODE_ADAPTERS`, `ADAPTERS_BY_LANGUAGE`, `getFencedCodeAdapter`, `adapter`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { JSX } from 'react';`；`import { MermaidDiagram } from '../diagrams/MermaidDiagram';`；`import { SvgDiagram } from '../diagrams/SvgDiagram';`；`import type { FencedCodeAdapter, FencedCodeBlock, FencedCodeRendererProps } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/codeBlocks/registry.tsx#L1-L30)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/codeBlocks/types.ts`**
- 源码声明的类型、组件或调用边界：`FencedCodeBlock`, `FencedCodeRendererProps`, `FencedCodeAdapter`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ComponentType } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/codeBlocks/types.ts#L1-L20)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/DiagramViewer.tsx`**
- 源码声明的类型、组件或调用边界：`HTMLAttributes`, `DiagramExportConfig`, `DiagramViewMode`, `DiagramToolbarAction`, `DiagramMenuItem`, `DiagramViewerProps`, `ToolbarButtonProps`, `ToolbarButton`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import clsx from 'clsx';`；`import { Copy, Ellipsis, ImageDown } from 'lucide-react';`；`import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/DiagramViewer.tsx#L1-L216)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/MermaidDiagram.tsx`**
- 源码声明的类型、组件或调用边界：`CSSProperties`, `DiagramToolbarAction`, `MermaidSvgRenderer`, `MermaidRenderState`, `MermaidDiagramProps`, `Point`, `MermaidSvgDimensions`, `normalizeMermaidSvgDimensions`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import clsx from 'clsx';`；`import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';`；`import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/MermaidDiagram.tsx#L1-L323)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/SvgDiagram.tsx`**
- 源码声明的类型、组件或调用边界：`DiagramViewMode`, `SvgMarkupStatus`, `SvgDiagramProps`, `getStatusText`, `SvgDiagram`, `previewRef`, `preview`, `status`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { UNTRUSTED_STATIC_PREVIEW_SANDBOX } from '../isolatedPreview';`；`import { DiagramViewer, type DiagramViewMode } from './DiagramViewer';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/SvgDiagram.tsx#L1-L71)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/diagramExport.ts`**
- 源码声明的类型、组件或调用边界：`SVG_EXPORT_MAX_DIMENSION`, `SVG_EXPORT_MAX_AREA`, `loadSvgImage`, `blob`, `url`, `image`, `convertSvgToPng`, `image`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { getSvgNaturalHeight, getSvgNaturalWidth } from '../../../utils/svgDimensions';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/diagramExport.ts#L1-L52)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/mermaidLayout.ts`**
- 源码声明的类型、组件或调用边界：`MERMAID_CANVAS_MAX_HEIGHT`, `MERMAID_CANVAS_MIN_HEIGHT`, `MERMAID_CANVAS_MIN_DISPLAY_SCALE`, `MERMAID_CANVAS_TOP_OFFSET`, `MERMAID_CANVAS_BOTTOM_OFFSET`, `MermaidCanvasLayoutInput`, `MermaidCanvasLayout`, `clampMermaidScale`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/mermaidLayout.ts#L1-L56)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/mermaidRuntime.ts`**
- 源码声明的类型、组件或调用边界：`MermaidRuntime`, `MermaidRuntimeLoader`, `MermaidSvgRenderer`, `MERMAID_CONFIG`, `createMermaidRenderer`, `runtimePromise`, `getRuntime`, `renderMermaidSvg`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { MermaidConfig } from 'mermaid';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/mermaidRuntime.ts#L1-L45)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/svgPreview.ts`**
- 源码声明的类型、组件或调用边界：`SvgMarkupStatus`, `SvgPreview`, `SVG_NAMESPACE`, `SVG_PREVIEW_DOCUMENT`, `getSvgPreview`, `document`, `root`, `svg`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createStaticPreviewDocument } from '../isolatedPreview';`；`import { getSvgNaturalHeight, getSvgNaturalWidth } from '../../../utils/svgDimensions';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/svgPreview.ts#L1-L117)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/useDiagramExportActions.ts`**
- 源码声明的类型、组件或调用边界：`DiagramExportConfig`, `DiagramExportActions`, `useDiagramExportActions`, `timeout`, `copyCode`, `downloadImage`, `image`, `outcome`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { convertSvgToPng, saveBlob } from './diagramExport';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/useDiagramExportActions.ts#L1-L49)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/isolatedPreview.ts`**
- 源码声明的类型、组件或调用边界：`UNTRUSTED_STATIC_PREVIEW_SANDBOX`, `UNTRUSTED_STATIC_PREVIEW_CSP`, `StaticPreviewDocumentOptions`, `createStaticPreviewDocument`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/isolatedPreview.ts#L1-L26)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-markdownrenderer/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
