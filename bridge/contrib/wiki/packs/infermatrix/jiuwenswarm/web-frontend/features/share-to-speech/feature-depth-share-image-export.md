---
name: feature-depth-share-image-export
description: 会话分享图导出的实现深读：render_share_image 关键字参数与超时默认值、browser_type/chrome_path 配置、playwright 惰性导入、PNG 流校验失败（share_export_png_incomplete 等）、ShareImageRenderAuth 的 cookie_value 不进 repr、init 超时测试与 900×900 无头渲染流程
metadata:
  scope: 收 share_image_export.py 渲染器与 shareImageExport.tsx Runner 的七个 facet 深读，来源另含 app_web.py、test_share_image_export.py；功能概览与任务 API 状态码归 feature-share-image-export
---
# Session Share-Image Export (Job Registry + Headless Renderer)：实现深读

## 现状

- [[feature-share-image-export]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **render_share_image keyword-only contract with module-level timeout defaults, returns Path** render_share_image 仅接受关键字参数：必需的 base_url、job_id、output_path（Path），可选 on_phase 回调、render_auth，以及四个超时/轮询参数（init_timeout_seconds、idle_timeout_seconds、absolute_timeout_seconds、poll_interval_seconds），
  - 默认值取模块常量 _RENDER_*；函数返回 Path。
- 来源：[jiuwenswarm/channels/web/share_image_export.py:L196–L208](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L196-L208)
- **Browser config: browser_type defaults to "auto" mapping to chrome channel; missing executable path errors** _configured_browser resolves the first non-blank configured path key, raises RuntimeError configured_share_export_browser_not_found if that path is not a file,
  - and browser_type (default "auto", lowercased) maps to channel "msedge" only for {msedge, edge, microsoft-edge, microsoft_edge}, otherwise "chrome"; executable_path defaults to None when unset.
- 来源：[jiuwenswarm/channels/web/share_image_export.py:L86–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L86-L98)
- **render_share_image lazily imports playwright.sync_api and couples browser launch to config-resolved chrome_path/browser_type** playwright.sync_api is imported inside render_share_image's body, so the function depends on Playwright only when invoked.
  - _configured_browser reads resolve_env_vars(get_config())['browser'], maps a dict chrome_path by platform key (else 'default'), raises RuntimeError "configured_share_export_browser_not_found" when a resolved path is not an existing file,
  - and derives channel "msedge" only for edge-like browser_type values, otherwise "chrome"; a missing/empty path returns (None, channel), so no executable is mandatory here.
- 来源：[jiuwenswarm/channels/web/share_image_export.py:L210–L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L210-L210),
  - [jiuwenswarm/channels/web/share_image_export.py:L69–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L69-L98)
- **_validate_png_stream fails fast on truncated or malformed PNG chunks** A stream smaller than signature+IEND, a mismatched signature, a short chunk header, or a chunk length exceeding the remaining bytes raises RuntimeError share_export_png_incomplete or share_export_png_invalid_signature;
  - at the API layer, FileNotFoundError from snapshot building becomes 404 history_not_found and ValueError becomes 400 with the error string.
- 来源：[jiuwenswarm/channels/web/share_image_export.py:L101–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L101-L117),
  - [jiuwenswarm/channels/web/app_web.py:L1226–L1232](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L1226-L1232)
- **ShareImageRenderAuth suppresses cookie_value from repr, hiding the desktop token at the cost of debuggability** 设计推断（非作者历史意图）：
- cookie_value is declared field(repr=False) so the desktop access token never appears in the dataclass repr; the cost is that the token value cannot be inspected via repr when diagnosing auth issues (inference from the shown field declaration).
- 来源：[jiuwenswarm/channels/web/share_image_export.py:L44–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L44-L52)
- **Automated runtime test asserts init-timeout failure path,
  - secret non-disclosure and context closure in render_share_image** test_render_runner_not_initialized_fails_within_init_timeout drives the real share_image_export.render_share_image via _call_render with a faked playwright module and _configured_browser monkeypatched to (None, "chrome"),
  - and asserts pytest.raises(RuntimeError, match="share_export_runner_not_initialized"), elapsed < 5 seconds, "desktop-secret" absent from the exception text, and harness.context.closed.
- 来源：[tests/unit_tests/channels/web/test_share_image_export.py:L614–L625](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/web/test_share_image_export.py#L614-L625),
  - [tests/unit_tests/channels/web/test_share_image_export.py:L525–L531](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/web/test_share_image_export.py#L525-L531),
  - [tests/unit_tests/channels/web/test_share_image_export.py:L516–L522](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/web/test_share_image_export.py#L516-L522)
- **render_share_image resolves browser config, then reports launching and starts headless Chromium with a 900×900 context** 在 render_share_image 内，先调用 _configured_browser()（L220），再根据 executable_path 是否为真组装 launch_options（设 executable_path，否则设 channel，且 headless: True，L221–L225），
  - 此后才执行 report("launching")（L229）——因此配置解析/失败可发生在 launching 回调之前。随后 sync_playwright 里 chromium.launch(**launch_options) 启动浏览器并 new_context(viewport 900×900, accept_downloads=True)。report 是条件回调：仅当 on_phase 非 None 时转发 phase。
  - 前端侧 ShareImageExportRunner 的 useEffect 回调先把 window.__SHARE_IMAGE_EXPORT_STATE 置为 { status: 'loading_snapshot' }，再 fetch /share-api/jobs/<jobId>/snapshot（cache: 'no-store'）。
- 来源：[jiuwenswarm/channels/web/share_image_export.py:L212–L235](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L212-L235),
  - [jiuwenswarm/channels/web/frontend/src/features/shareImageExport.tsx:L1466–L1478](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/shareImageExport.tsx#L1466-L1478)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-share-image-export.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L86-L98；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L101-L117
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L1226-L1232；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L44-L52
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L210-L210；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L69-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/web/test_share_image_export.py:L614-L625；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/web/test_share_image_export.py:L525-L531
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/web/test_share_image_export.py:L516-L522；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L196-L208
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/share_image_export.py:L212-L235；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/shareImageExport.tsx:L1466-L1478
- 源页字段（feature）：share-image-export
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/vite.config.ts；jiuwenswarm/channels/web/share_image_export.py
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/vite.config.ts；jiuwenswarm/channels/web/share_image_export.py；jiuwenswarm/channels/web/frontend/src/features/shareImageExport.tsx；jiuwenswarm/channels/web/frontend/src/features/shareImageArchive.ts
  - jiuwenswarm/channels/web/frontend/src/features/shareImageExport.css；jiuwenswarm/channels/web/app_web.py；jiuwenswarm/channels/web/frontend/src/features/shareImageJob.ts；jiuwenswarm/channels/web/frontend/src/features/shareImagePng.worker.ts
  - jiuwenswarm/channels/web/frontend/src/features/shareImagePngEncoder.ts；jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/main.tsx；jiuwenswarm/channels/web/frontend/src/features/shareImageRaster.ts
