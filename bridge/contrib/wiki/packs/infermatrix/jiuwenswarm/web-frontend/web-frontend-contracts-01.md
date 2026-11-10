---
name: web-frontend-contracts-01
description: web-frontend 源码接口与集成边界 01：channels/web 下 app_web.py、directory_picker.py、file_picker.py、hub_oauth.py、share_image_export.py 与 frontend 的 index.html、featureFlags.ts、main.tsx、tailwind.config.js、vite.config.ts、vite-env.d.ts 共 11 个文件的静态声明
metadata:
  scope: 只收这 11 个文件的接口与依赖声明；其行为与取舍说明归 knowledge-web-frontend
---
# web-frontend 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/app_web.py`**
- 源码对模块职责的说明：Serve built frontend static files with optional reverse proxy.。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import errno`；`import hmac`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L1-L2386)。
- **`jiuwenswarm/channels/web/directory_picker.py`**
- 源码对模块职责的说明：浏览器 / Web 通道使用的本机目录选择器（非 pywebview）。。
- 调用入口 `select_directory_native(initial_dir)`；声明返回 `str / None`。
- 调用入口 `select_file_native(initial_dir, title)`；声明返回 `str / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`import shutil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L1-L520)。
- **`jiuwenswarm/channels/web/file_picker.py`**
- 源码对模块职责的说明：浏览器 / Web 通道使用的本机文件选择器（非 pywebview）。。
- 调用入口 `get_last_file_picker_dir()`；声明返回 `str / None`。
- 调用入口 `remember_file_picker_dir(path)`；声明返回 `None`。
- 调用入口 `resolve_file_picker_initial_dir(initial_dir)`；声明返回 `str`。
- 调用入口 `attachment_mime_type(filename)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import base64`；`import logging`；`import mimetypes`。
- 模块级配置或常量名称：`IMAGE_EXTENSIONS`, `MAX_IMAGE_BYTES`, `FORBIDDEN_DOCUMENT_EXTENSIONS`, `ATTACHMENT_DIALOG_EXTENSIONS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/file_picker.py#L1-L667)。
- **`jiuwenswarm/channels/web/frontend/index.html`**
- 源码声明的类型、组件或调用边界：`len`, `i`, `escaped`；这是词法声明索引，不把局部变量当成对外导出 API。
- 页面装配边界：body, link, script 标签；资源装载与宿主连接取决于对应属性和脚本实现。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/index.html#L1-L61)。
- **`jiuwenswarm/channels/web/frontend/src/featureFlags.ts`**
- 源码声明的类型、组件或调用边界：`FEATURE_APP_UPDATER_UI`, `FEATURE_PERSONAL_CONTEXT_UI`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/featureFlags.ts#L1-L11)。
- **`jiuwenswarm/channels/web/frontend/src/main.tsx`**
- 源码声明的类型、组件或调用边界：`flagA2UIIconFontAvailability`, `fonts`, `hasMaterialSymbols`, `handleA2UIAction`, `resolveOpenSourceSettingsRequest`, `runnerJobId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import './i18n';`；`import ReactDOM from 'react-dom/client';`；`import { A2UIProvider } from '@a2ui/react';`；`import type { A2UIClientEventMessage } from '@a2ui/react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/main.tsx#L1-L63)。
- **`jiuwenswarm/channels/web/frontend/tailwind.config.js`**
- 源码声明的类型、组件或调用边界：`color`, `translucentColor`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import typography from '@tailwindcss/typography';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tailwind.config.js#L1-L204)。
- **`jiuwenswarm/channels/web/frontend/vite.config.ts`**
- 源码声明的类型、组件或调用边界：`ChildProcess`, `ConfigWithLogger`, `ErrorWithCode`, `SECRET_TOKENS`, `NON_SENSITIVE_KEY_OVERRIDES`, `looksSecretKey`, `tokens`, `setIntersect`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Plugin } from 'vite'`；`import { defineConfig, searchForWorkspaceRoot } from 'vite'`；`import react from '@vitejs/plugin-react'`；`import svgr from 'vite-plugin-svgr'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L1-L1492)。
- **`jiuwenswarm/channels/web/hub_oauth.py`**
- 源码对模块职责的说明：Local handoff for SkillHub-hosted OAuth; no provider secret is stored here.。
- 调用入口 `start(provider, host)`；声明返回 `tuple[int, dict]`。
- 调用入口 `complete(query)`；声明返回 `tuple[int, dict]`。
- 调用入口 `result(flow, claim)`；声明返回 `tuple[int, dict]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hmac`；`import json`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/hub_oauth.py#L1-L130)。
- **`jiuwenswarm/channels/web/share_image_export.py`**
- 源码对模块职责的说明：Isolated browser renderer and in-process job registry for share-image export.。
- `ShareImageRenderAuth` 定义类型边界。
- 调用入口 `render_share_image(base_url, job_id, output_path, on_phase, render_auth, init_timeout_seconds, idle_timeout_seconds, absolute_timeout_seconds, poll_interval_seconds)`；声明返回 `Path`。
- `ShareImageExportManager` 定义类型边界；方法入口：`__init__`, `create_job`, `get_status`, `get_active_status`, `get_snapshot_path`, `get_result`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/share_image_export.py#L1-L589)。
- **`jiuwenswarm/channels/web/frontend/src/vite-env.d.ts`**
- 源码声明的类型、组件或调用边界：`ImportMetaEnv`, `ImportMeta`, `DesktopSaveResult`, `DesktopBlobSaveStartResult`, `Window`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/vite-env.d.ts#L1-L61)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
