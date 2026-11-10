---
name: components-artifactspanel-contracts-02
description: components-artifactspanel 源码接口 02：ArtifactsPanel 下 ooxmlArchiveLimits、pptxPresentationParser、pptxPreview.worker、pptxPreviewModel、spreadsheetPreview.worker、spreadsheetPreviewModel、spreadsheetWorkbookParser 七个文件的声明与导入依赖
metadata:
  scope: 只收这七个文件的接口记录；其余文件归 components-artifactspanel-contracts-01；目录入口归 components-artifactspanel-overview
---
# components-artifactspanel 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/ooxmlArchiveLimits.ts`**
- 源码声明的类型、组件或调用边界：`MEBIBYTE`, `END_OF_CENTRAL_DIRECTORY_SIGNATURE`, `ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE`, `ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE`, `CENTRAL_DIRECTORY_ENTRY_SIGNATURE`, `ZIP64_EXTRA_FIELD_ID`, `MAX_ZIP_COMMENT_BYTES`, `OoxmlArchiveLimits`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/ooxmlArchiveLimits.ts#L1-L187)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/pptxPresentationParser.ts`**
- 源码声明的类型、组件或调用边界：`PresentationBounds`, `PresentationChart`, `PresentationColor`, `PresentationData`, `PresentationFill`, `PresentationImage`, `PresentationNode`, `PresentationParagraph`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import JSZip from 'jszip';`；`import { SaxesParser } from 'saxes';`；`import { OoxmlArchiveLimitError, PRESENTATION_ARCHIVE_LIMITS, inspectOoxmlArchive, isOoxmlArchiveLim`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/pptxPresentationParser.ts#L1-L1118)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/pptxPreview.worker.ts`**
- 源码声明的类型、组件或调用边界：`workerScope`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { parsePresentation } from './pptxPresentationParser';`；`import { isOoxmlArchiveLimitError } from './ooxmlArchiveLimits';`；`import type { PresentationWorkerRequest, PresentationWorkerResponse } from './pptxPreviewModel';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/pptxPreview.worker.ts#L1-L21)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/pptxPreviewModel.ts`**
- 源码声明的类型、组件或调用边界：`MAX_PRESENTATION_PREVIEW_BYTES`, `MAX_PRESENTATION_UNCOMPRESSED_BYTES`, `PresentationColor`, `PresentationFill`, `PresentationStroke`, `PresentationSpacing`, `presentationLineHeight`, `PresentationRun`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { PRESENTATION_ARCHIVE_LIMITS } from './ooxmlArchiveLimits';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/pptxPreviewModel.ts#L1-L137)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/spreadsheetPreview.worker.ts`**
- 源码声明的类型、组件或调用边界：`workerScope`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { parseSpreadsheetWorkbook } from './spreadsheetWorkbookParser';`；`import { isOoxmlArchiveLimitError } from './ooxmlArchiveLimits';`；`import type { SpreadsheetWorkerRequest, SpreadsheetWorkerResponse } from './spreadsheetPreviewModel'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/spreadsheetPreview.worker.ts#L1-L23)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/spreadsheetPreviewModel.ts`**
- 源码声明的类型、组件或调用边界：`MAX_SPREADSHEET_PREVIEW_BYTES`, `SpreadsheetCssValue`, `SpreadsheetCellStyle`, `SpreadsheetCellData`, `SpreadsheetRowData`, `SpreadsheetAxisSize`, `SpreadsheetMergeRange`, `SpreadsheetCellComment`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { SPREADSHEET_ARCHIVE_LIMITS } from './ooxmlArchiveLimits';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/spreadsheetPreviewModel.ts#L1-L191)。
- **`jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/spreadsheetWorkbookParser.ts`**
- 源码声明的类型、组件或调用边界：`Border`, `SaxesTagNS`, `SpreadsheetCellData`, `SpreadsheetCellStyle`, `SpreadsheetChart`, `SpreadsheetChartSeries`, `SpreadsheetDrawingAnchor`, `SpreadsheetImage`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import ExcelJS, { type Border, type Cell, type Color, type Fill, type Font, type Style, type Workboo`；`import JSZip from 'jszip';`；`import { SaxesParser, type SaxesTagNS } from 'saxes';`；`import SSF from 'ssf';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/spreadsheetWorkbookParser.ts#L1-L1115)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-artifactspanel/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
