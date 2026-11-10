---
name: components-artifactspanel-contracts-01
description: components-artifactspanel 源码接口 01：ArtifactsPanel 下 ArtifactExpandedPanel、CodePreview、DocxPreview、FilePreview、PresentationPreview、SpreadsheetPreview、artifactCollection、chartGeometry、codeLanguageExtensions、codeLanguages、filePreviewModel、index、officeFontStack 共十三个文件的声明与导入依赖
metadata:
  scope: 只收这十三个文件的接口记录；OOXML 限制、pptx 与表格解析及 worker 文件归 components-artifactspanel-contracts-02；目录入口归 components-artifactspanel-overview
---
# components-artifactspanel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/ArtifactExpandedPanel.tsx`**
- 源码声明的类型、组件或调用边界：`ArtifactExpandedPanel`, `artifacts`, `selectedArtifact`, `selectedIndex`, `hasPrev`, `hasNext`, `handlePresentationStructureInvalidChange`, `next`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { useSessionArtifacts } from '.';`；`import { ArtifactList } from '.';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/ArtifactExpandedPanel.tsx#L1-L96)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/CodePreview.tsx`**
- 源码声明的类型、组件或调用边界：`lightPreviewTheme`, `LoadState`, `CodePreview`, `hostRef`, `disposed`, `view`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';`；`import { EditorState } from '@codemirror/state';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/CodePreview.tsx#L1-L95)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/DocxPreview.tsx`**
- 源码声明的类型、组件或调用边界：`DocxPreviewState`, `DOCX_PAGE_CLASS`, `DocxPreview`, `bodyRef`, `styleRef`, `body`, `styleHost`, `abortController`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef, useState } from 'react';`；`import { LoaderCircle } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/DocxPreview.tsx#L1-L116)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/FilePreview.tsx`**
- 源码声明的类型、组件或调用边界：`PreviewKind`, `PreviewArtifact`, `TextKind`, `Notice`, `TextPreview`, `url`, `cancelled`, `contentType`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { AlertCircle, LoaderCircle } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { MarkdownRenderer } from '../MarkdownRenderer';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/FilePreview.tsx#L1-L161)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/PresentationPreview.tsx`**
- 源码声明的类型、组件或调用边界：`CSSProperties`, `PresentationChart`, `PresentationData`, `PresentationFill`, `PresentationImage`, `PresentationNode`, `PresentationParagraph`, `PresentationShape`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from`；`import { AlertCircle, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import clsx from 'clsx';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/PresentationPreview.tsx#L1-L934)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/SpreadsheetPreview.tsx`**
- 源码声明的类型、组件或调用边界：`CSSProperties`, `SpreadsheetCellData`, `SpreadsheetCellStyle`, `SpreadsheetChart`, `SpreadsheetDrawingAnchor`, `SpreadsheetMergeRange`, `SpreadsheetSheetData`, `SpreadsheetWorkerResponse`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as Reac`；`import { AlertCircle, ChevronDown, LoaderCircle } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import clsx from 'clsx';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/SpreadsheetPreview.tsx#L1-L739)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts`**
- 源码声明的类型、组件或调用边界：`ArtifactItem`, `fileArtifactId`, `normalizeDownloadUrl`, `normalizedUrl`, `normalizedToken`, `preferArtifact`, `existingTs`, `candidateTs`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { FileDownloadItem, Message } from '../../types';`；`import { extractTokenFromDownloadUrl, getFileIdentityKey, resolveFilePath } from '../../utils/fileDo`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts#L1-L119)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/chartGeometry.ts`**
- 源码声明的类型、组件或调用边界：`AxisSpan`, `CategoryBand`, `AxisDomain`, `ensureNonZeroAxisSpan`, `linearPosition`, `spanFromBaseline`, `categoryCenter`, `categoryPoint`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/chartGeometry.ts#L1-L79)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/codeLanguageExtensions.ts`**
- 源码声明的类型、组件或调用边界：`CODE_LANGUAGE_EXTENSIONS`, `CodeLanguageExtension`, `CODE_LANGUAGE_EXTENSION_SET`, `fileExtension`, `value`, `isCodeLanguageExtension`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/codeLanguageExtensions.ts#L1-L50)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/codeLanguages.ts`**
- 源码声明的类型、组件或调用边界：`CodeLanguageExtension`, `LanguageLoader`, `javascript`, `cpp`, `LANGUAGE_LOADERS`, `loadCodeLanguage`, `extension`, `mime`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Extension } from '@codemirror/state';`；`import { StreamLanguage } from '@codemirror/language';`；`import { fileExtension, isCodeLanguageExtension, type CodeLanguageExtension } from './codeLanguageEx`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/codeLanguages.ts#L1-L57)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts`**
- 源码声明的类型、组件或调用边界：`PreviewFile`, `PreviewResource`, `TextKind`, `PreviewKind`, `TEXT_EXTENSIONS`, `IMAGE_MIME_TYPES`, `IMAGE_EXTENSIONS`, `inlineDownloadUrl`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { fileExtension, isCodeLanguageExtension } from './codeLanguageExtensions';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts#L1-L99)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx`**
- 源码声明的类型、组件或调用边界：`DesktopSaveApiResult`, `ArtifactItem`, `DownloadCapableWindow`, `useSessionArtifacts`, `activeSessionId`, `messages`, `useSessionArtifactsCount`, `ArtifactList`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo } from 'react';`；`import { Download } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import clsx from 'clsx';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L1-L121)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/officeFontStack.ts`**
- 源码声明的类型、组件或调用边界：`MICROSOFT_YAHEI`, `SIMSUN`, `CROSS_PLATFORM_FALLBACK_FONTS`, `officeFontStack`, `secondaryFonts`, `simSunIndex`, `declared`, `seen`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/officeFontStack.ts#L1-L54)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-artifactspanel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
