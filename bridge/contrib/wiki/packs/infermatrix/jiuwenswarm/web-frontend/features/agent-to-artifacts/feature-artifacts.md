---
name: feature-artifacts
description: 会话产物面板功能知识入口：buildArtifacts 按消息 fileItems 去重与排序、previewKind 与下载/预览地址（artifactDownloadUrl 等）、条目字段与桌面 pywebview 保存、设计取舍与验收步骤，并链接 web-chat、desktop 等关联功能页
metadata:
  scope: 只收会话产物列表、预览与下载的功能概览与六个 facet 摘要；handleDownload 契约、桌面保存桥、下载失败分支、地址优先级与 node:test 断言等实现细节归 feature-depth-artifacts，Web 前端 owner 级架构归 knowledge-web-frontend
---
# 会话产物列表、预览与下载的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-artifacts.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/AGENTS.md
- 源页字段（feature）：artifacts
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts
  - jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/codeLanguageExtensions.ts；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/codeLanguages.ts；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/SpreadsheetPreview.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageItem.tsx；jiuwenswarm/gateway/channel_manager/web/container_file_http.py；jiuwenswarm/channels/web/frontend/src/utils/fileDownloadDedup.ts；jiuwenswarm/channels/web/frontend/vite.config.ts
  - jiuwenswarm/channels/web/frontend/src/components/FileIcon/fileIconModel.ts；jiuwenswarm/channels/web/frontend/src/components/FileIcon/index.tsx；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/officeFontStack.ts
  - jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/ooxmlArchiveLimits.ts；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/pptxPresentationParser.ts；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/pptxPreviewModel.ts
  - jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/pptxPreview.worker.ts；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/spreadsheetWorkbookParser.ts；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/spreadsheetPreviewModel.ts
  - jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/spreadsheetPreview.worker.ts；jiuwenswarm/server/runtime/gateway_adapter/workspace_file_adapter.py；jiuwenswarm/agents/harness/common/tools/verified_download_assets.py
  - jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/CodePreview.tsx；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/DocxPreview.tsx；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/ArtifactExpandedPanel.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/PresentationPreview.tsx；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/FilePreview.tsx；jiuwenswarm/channels/web/frontend/src/features/desktopBrowserFile.ts；jiuwenswarm/channels/web/app_web.py
  - jiuwenswarm/agents/harness/common/tools/web_file_download.py；jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewContent.tsx；jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewIcon.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/chartGeometry.ts
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- 产物面板从当前会话 messages 的 fileItems 构建集合，以文件身份去重并按消息时间排序；同一文件优先使用较新的元数据，并补齐可下载资源。列表、预览类型选择和实际下载是分离边界，消息包含路径或 token 仅证明存在引用，不能单独证明服务端文件仍可读取。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L1–L121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L1-L121)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts:L1–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts#L1-L119)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts:L1–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts#L1-L99)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 接口与调用入口（API）

- buildArtifacts 将消息附件变成 ArtifactItem，useSessionArtifacts 选择 activeSession 的消息，previewKind 按 MIME 和扩展名选择展示组件。下载使用 artifactDownloadUrl，二进制与文本预览分别用 artifactBinaryPreviewUrl 和 artifactTextPreviewUrl；下载 token 可归一为 /file-api/download 请求地址。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L1–L121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L1-L121)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts:L1–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts#L1-L119)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts:L1–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts#L1-L99)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 配置入口与生效条件

- 每项可携带 name、size、mimeType、downloadUrl、downloadToken、path 与 timestamp。预览资源优先使用下载地址，路径兜底使用 raw-file 或 file-content 接口；桌面 pywebview 的 download_file 可走原生保存，浏览器使用链接下载。文本、Office、图片、视频等类型的支持以 previewKind 分支为准。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L1–L121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L1-L121)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts:L1–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts#L1-L119)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts:L1–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts#L1-L99)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 设计取舍

- **设计推断**：基于会话消息提取产物不需要额外维护第二份文件目录，代价是产物完整性受消息恢复和附件元数据影响。去重能减少重复展示，但必须保留最新资源和缺失路径；格式可识别、文件下载成功与预览解析成功仍是三个独立状态。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L1–L121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L1-L121)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts:L1–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts#L1-L119)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts:L1–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts#L1-L99)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 数据流与关联功能

- Agent 或协作消息带回文件引用后，侧栏展示当前会话产物，选择项进入对应预览，用户可下载或交给桌面浏览器打开。该路径关联生成图片、SkillDev 打包与工作区访问；切换会话应重新选择消息集合，不能把另一线程的产物状态直接沿用。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L1–L121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L1-L121)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts:L1–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts#L1-L119)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts:L1–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts#L1-L99)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 怎样验证

- 检查重复附件、不同时间和不完整资源的合并，覆盖会话切换与历史恢复。对文本、图片、PDF 和 Office 文件分别验证预览与下载，再测试过期 token、缺失路径、桌面保存取消及失败提示。本页未运行上游文件服务或 Office 渲染测试。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L1–L121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L1-L121)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts:L1–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts#L1-L119)；
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts:L1–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts#L1-L99)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。
- 关联阅读：[[feature-web-chat-1]]、[[feature-web-chat-2]]（web-chat）；[[feature-desktop]]（desktop）；[[feature-image-generation]]（image-generation）；[[feature-skill-development]]（skill-development）。
