---
name: feature-share-image-export
description: 会话分享图导出功能概览：浏览器与 locale/超时配置、/share-api/jobs 任务 API 状态码、不可变快照加子进程无头渲染流水线、同会话任务复用、独立无头浏览器的 cookie 注入取舍
metadata:
  scope: 只收配置、API、架构、功能、取舍五个 facet 摘要；render_share_image 参数契约、PNG 校验与测试细节归 feature-depth-share-image-export
---
# 会话分享图导出：任务注册表与无头渲染器

## 现状

- **浏览器选择、locale 与超时参数**
- 渲染浏览器由 jiuwenswarm 配置的 browser 段决定：chrome_path 可为字符串，或按平台（windows/macos/linux/default）取值的字典；配置了路径但文件不存在会抛 configured_share_export_browser_not_found。browser_type 为 msedge/edge 等别名时使用 Edge channel，否则 chrome；未配置路径时通过 channel 启动。locale 由 POST 请求体传入，缺省 'zh'，Runner 会据此 i18n.changeLanguage。
  - 时间常量硬编码在渲染器：任务 TTL 1 小时（开发态同为 60*60*1000ms），渲染 init 超时 15s、idle 与绝对超时各 15 分钟、轮询 0.25s，PNG 输出宽度固定 2250、最大高度 128000。
- Sources / 来源：[jiuwenswarm/channels/web/share_image_export.py:L69–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L69-L98),
  - [jiuwenswarm/channels/web/share_image_export.py:L29–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L29-L40),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L626–L636](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L626-L636)
- **任务 API 的状态码与状态契约**
- POST /share-api/jobs 创建新任务时返回 202；若同一 session 已有 queued/running 任务则不重复创建，返回 200 且带 reused:true。GET /share-api/jobs?session_id= 只返回活动任务，找不到时 404 active_job_not_found，缺 session_id 时 400。任务状态统一为 {job_id, session_id, filename, state(queued|running|completed|failed), phase, error}；
  - GET /share-api/jobs/:jobId/download 仅在 completed 状态可用，否则 409 job_not_completed。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L585–L597](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L585-L597),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L625–L628](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L625-L628),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L733–L736](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L733-L736),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L746–L765](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L746-L765)
- **不可变快照 + 子进程无头渲染的流水线**
- 导出分三段：dev Vite 插件先从 agent/sessions 下的 history.jsonl（或 legacy history.json）与 metadata.json 构建不可变快照，写入临时目录 snapshot.json，然后 spawn `uv run python -m jiuwenswarm.channels.web.share_image_export` 子进程，通过逐行解析子进程 stdout 的 NDJSON 事件（phase/error/filename）更新内存中 Map 里的任务状态；
  - Python 渲染器再用 Playwright 启动独立 headless Chromium 打开 `/share-export-runner?job_id=`，前端 Runner fetch 快照渲染，并通过反复替换（而非原地修改）`window.__SHARE_IMAGE_EXPORT_STATE` 对象暴露状态供轮询。任务判定完成需同时满足退出码 0、无 job.error 且 resultPath 文件存在。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L626–L673](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L626-L673),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L679–L731](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L679-L731),
  - [jiuwenswarm/channels/web/share_image_export.py:L250–L271](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L250-L271),
  - [jiuwenswarm/channels/web/frontend/src/features/shareImageExport.tsx:L1466–L1500](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/shareImageExport.tsx#L1466-L1500)
- **同会话活动任务复用**
- 创建任务时按 session 去重：dev 服务端 `findActiveShareImageJob` 只匹配 queued/running 状态的任务，命中时不再创建新任务，直接返回既有任务状态并附加 `reused: true`。Python 侧 `ShareImageExportManager.create_job` 同样复用活动任务（返回 `reused` 标志），任务结束后 `get_active_status` 返回 None（测试中验证了 completed 后的清空）。
  - 浏览器凭据注入是另一项特性：桌面模式下 `ShareImageRenderAuth` 携带的 cookie 会在打开 runner 页面前注入同一 loopback origin（httpOnly、sameSite=Lax，不出现在 URL 中），普通 web 模式不注入。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L546–L548](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L546-L548),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L625–L628](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L625-L628),
  - [tests/unit_tests/channels/web/test_share_image_export.py:L274–L282](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/web/test_share_image_export.py#L274-L282),
  - [tests/unit_tests/channels/web/test_share_image_export.py:L537–L555](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/web/test_share_image_export.py#L537-L555)
- **独立无头浏览器与凭据隔离的代价**
- 渲染选择在专用无头 Playwright Chromium 中执行而非复用桌面 WebView：源码注释指出无头 BrowserContext 不共享桌面 WebView 的 Cookie，因此必须把当前实例的 desktop cookie 注入同一 loopback origin，否则 `/share-export-runner` 直接 403。作为配套约束，`ShareImageRenderAuth` 的 `cookie_value` 用 `field(repr=False)` 抑制 repr，文档说明该令牌绝不能进入任务状态、快照文件、错误串或日志。
  - 代价是浏览器可用性依赖配置（`chrome_path` 指向的文件不存在时抛 `configured_share_export_browser_not_found`），且每个任务都要冷启动一个浏览器进程。
- Sources / 来源：[jiuwenswarm/channels/web/share_image_export.py:L43–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L43-L52),
  - [jiuwenswarm/channels/web/share_image_export.py:L239–L241](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L239-L241),
  - [jiuwenswarm/channels/web/share_image_export.py:L91–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L91-L93)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-share-image-export.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L69-L98；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L29-L40
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L626-L636；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L585-L597
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L625-L628；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L733-L736
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L746-L765；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L626-L673
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L679-L731；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L250-L271
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/shareImageExport.tsx:L1466-L1500；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L546-L548
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/web/test_share_image_export.py:L274-L282；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/web/test_share_image_export.py:L537-L555
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L43-L52；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L239-L241
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L91-L93
- 源页字段（feature）：share-image-export
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/vite.config.ts；jiuwenswarm/channels/web/share_image_export.py
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/vite.config.ts；jiuwenswarm/channels/web/share_image_export.py；jiuwenswarm/channels/web/frontend/src/features/shareImageExport.tsx；jiuwenswarm/channels/web/frontend/src/features/shareImageArchive.ts
  - jiuwenswarm/channels/web/frontend/src/features/shareImageExport.css；jiuwenswarm/channels/web/app_web.py；jiuwenswarm/channels/web/frontend/src/features/shareImageJob.ts；jiuwenswarm/channels/web/frontend/src/features/shareImagePng.worker.ts
  - jiuwenswarm/channels/web/frontend/src/features/shareImagePngEncoder.ts；jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/main.tsx；jiuwenswarm/channels/web/frontend/src/features/shareImageRaster.ts
