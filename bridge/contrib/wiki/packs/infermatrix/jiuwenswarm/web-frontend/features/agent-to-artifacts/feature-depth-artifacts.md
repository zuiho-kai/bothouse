---
name: feature-depth-artifacts
description: 会话产物实现深读：handleDownload 调用契约、桌面 pywebview 保存桥与 download_file 失败不回退、不可下载项、downloadUrl 优先于 path 与 inline=1 的地址规则、artifactCollection 的 node:test 断言、useSessionArtifacts 过滤去重排序
metadata:
  scope: 只收 ArtifactsPanel 与 artifactCollection、filePreviewModel 的实现级证据与设计推断；功能概览与验收步骤归 feature-artifacts，Web 前端 owner 级架构归 knowledge-web-frontend
---
# 会话产物列表、预览与下载：实现深读

## 现状

- [[feature-artifacts]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **handleDownload 的调用契约** handleDownload 先用 artifactDownloadUrl(artifact) 解析地址，返回 null 时直接 return；在 pywebview 桌面环境下调用 window.pywebview.api.download_file(downloadUrl, artifact.name || 'download')，浏览器环境则动态创建 <a> 元素设置 href 与 download 属性模拟点击下载。调用方需保证 artifact 至少有 downloadUrl 或 path，否则按钮渲染为 disabled。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L45–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L45-L64),
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L105–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L105-L109)
- **桌面端 pywebview 保存桥** 列表通过 DownloadCapableWindow 类型声明检测 window.pywebview.api.download_file，存在时经 executeDesktopSave 包装执行原生保存而非浏览器下载；点击条目还会先尝试 openFileInDesktopBrowser 把文件交给桌面浏览器打开。这使同一组件在 Web 与桌面壳下复用，但行为依赖宿主注入的桥接 API。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L15–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L15-L21),
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L49–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L49-L56),
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L81–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L81-L84)
- **下载失败与不可下载项** pywebview 桌面保存返回 'failed' 时用 window.alert 弹出 t('artifacts.downloadFailed') 提示且不再回退到浏览器下载；artifactDownloadUrl 返回 null 时 handleDownload 静默 return；既无 downloadUrl 也无 path 的条目下载按钮 disabled。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L45–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L45-L56),
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts:L54–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts#L54-L57),
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L105–L105](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L105-L105)
- **无专属设置项；地址由 downloadUrl 优先于 path 的资源优先级与 inline=1 默认决定** 所示切片中产物功能没有独立开关或环境变量，行为由每项资源字段的优先级决定：artifactDownloadUrl 优先返回 downloadUrl，其次用 path 拼 /file-api/raw-file?path=<encodeURIComponent(path)>，两者皆无则返回 null；列表下载按钮正是在 !artifact.downloadUrl && !artifact.path 时 disabled。
  - 预览侧 inlineDownloadUrl 对非 blob:/data: 的 downloadUrl 默认追加 inline=1 并只返回 pathname+search；文本预览的 path 兜底为 /file-api/file-content?path=…&encoding=auto，二进制兜底为 raw-file。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts:L47–L67](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts#L47-L67),
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L99–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L99-L112)
- **检测到 pywebview download_file 即走桌面原生保存，失败告警后不再回退链接下载** 设计推断（非作者历史意图）：
- （推断）handleDownload 在存在 window.pywebview.api.download_file 时调用 executeDesktopSave：收益是桌面宿主可接管为原生保存流程；代价是该分支返回 'failed' 时仅 window.alert 提示，随后第 55 行 return，跳过下方创建 a 标签点击的浏览器下载兜底（'cancelled' 结局不告警）。分支行为本身是所示代码的事实，收益/代价的取舍判断为本人分析，未见文档记载该意图。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L45–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L45-L64)
- **node:test 断言 buildArtifacts 的过滤、token 归一与同身份去重** 入口是 tests/artifactCollection.test.mjs（node:test，从 ../node_modules/.cache/artifact-collection/artifactCollection.mjs 导入被测函数）。'
  - rejects file entries without a display name or readable resource' 断言空白 name 与无可读资源的项被丢弃，且仅 token 的项 downloadUrl 归一为 /file-api/download?token=token-only；'
  - duplicate file cards select the retained artifact with the same stable id' 用同 path 不同 token 的两条 assistant 消息断言 artifacts.length 为 1、id 与 fileArtifactId 一致且保留项取较新消息的 download_url。此处仅记录断言内容，不代表当前已运行通过。
- 来源：[jiuwenswarm/channels/web/frontend/tests/artifactCollection.test.mjs:L1–L4](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/artifactCollection.test.mjs#L1-L4),
  - [jiuwenswarm/channels/web/frontend/tests/artifactCollection.test.mjs:L42–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/artifactCollection.test.mjs#L42-L55),
  - [jiuwenswarm/channels/web/frontend/tests/artifactCollection.test.mjs:L71–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/artifactCollection.test.mjs#L71-L92)
- **activeSessionId 会话消息经 buildArtifacts 过滤、去重并按时间降序，ArtifactList 渲染空态或逐项条目** useSessionArtifacts 取 activeSessionId 会话消息（缺省 []）并 memoize buildArtifacts：跳过无名称或 download_url/download_token/path 皆空的文件，按 getFileIdentityKey 去重合并、按 timestamp 降序；ArtifactList 在空列表时渲染空态，否则逐项渲染，且无 downloadUrl 且无 path 时下载按钮禁用。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L23–L120](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx#L23-L120),
  - [jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts:L71–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts#L71-L119)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-artifacts.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L23-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts:L95-L119
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts:L75-L93
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L45-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L105-L109
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L15-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L49-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L81-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L45-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts:L54-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L105-L105
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/artifactCollection.test.mjs:L1-L4
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/artifactCollection.test.mjs:L42-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/artifactCollection.test.mjs:L71-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts:L47-L67
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L99-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx:L23-L120
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts:L71-L119
- 源页字段（feature）：artifacts
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/index.tsx；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/artifactCollection.ts；jiuwenswarm/channels/web/frontend/src/components/ArtifactsPanel/filePreviewModel.ts
