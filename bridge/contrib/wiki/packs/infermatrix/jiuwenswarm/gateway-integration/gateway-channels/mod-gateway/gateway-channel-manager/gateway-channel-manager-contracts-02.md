---
name: gateway-channel-manager-contracts-02
description: gateway-channel-manager 源码接口与集成边界 02：小艺 media 与 push、tui_channel 与 tui_connect、web 目录各文件（文件 HTTP、git ws、生命周期、ASR、轨迹 HTTP、登录路由、ws 适配器）的声明
metadata:
  scope: 只收小艺 media 起的文件声明；channel_manager 基类与 IM 平台文件服务归 gateway-channel-manager-contracts-01
---
# gateway-channel-manager 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/media.py`**
- 源码对模块职责的说明：XiaoYi Media Utils - 媒体下载、处理和保存功能。 基于 TypeScript xiaoyi-media.ts 实现。。
- `MediaDownloadOptions` 定义类型边界。
- `DownloadedMedia` 定义类型边界。
- `MediaFile` 定义类型边界。
- 调用入口 `is_image_mime_type(mime_type)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import asyncio`；`import base64`；`from dataclasses import dataclass`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/media.py#L1-L353)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py`**
- 源码对模块职责的说明：XiaoYi Push Message Service - 主动推送消息服务.。
- `PushConfig` 定义类型边界。
- `XiaoYiPushService` 定义类型边界；方法入口：`__init__`, `send_push`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import base64`；`import hashlib`；`import hmac`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py#L1-L132)。
- **`jiuwenswarm/gateway/channel_manager/tui/tui_channel.py`**
- 源码对模块职责的说明：TuiChannel —— TUI 终端 WebSocket 通道（出站契约 + 五维索引）.。
- `TuiChannelConfig` 定义类型边界。
- `TuiChannel` 继承 `BaseWsChannel`；方法入口：`__init__`, `on_message`, `start`, `stop`, `send`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from dataclasses import dataclass`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/tui/tui_channel.py#L1-L270)。
- **`jiuwenswarm/gateway/channel_manager/tui/tui_connect.py`**
- `CliHandlersBindParams` 定义类型边界。
- `CliRouteBindParams` 定义类型边界。
- `ForwardRewindE2AParams` 定义类型边界。
- 调用入口 `resolve_tui_session_project_path(session)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import contextlib`；`import logging`。
- 模块级配置或常量名称：`CLI_FORWARD_REQ_METHODS`, `CLI_FORWARD_NO_LOCAL_HANDLER_METHODS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/tui/tui_connect.py#L1-L2728)。
- **`jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py`**
- 源码对模块职责的说明：WebChannel RPC handlers and shared constants (used by app gateway; single source with app.py).。
- `WebHandlersBindParams` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import importlib.util`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L1-L5794)。
- **`jiuwenswarm/gateway/channel_manager/web/container_file_http.py`**
- 源码对模块职责的说明：Gateway WebChannel ''/file-api'' HTTP routes (agentos_router, same port as ''/ws'').。
- `RawFileQuery` 继承 `BaseModel`。
- `FileContentGetQuery` 继承 `BaseModel`。
- `ListFilesQuery` 继承 `BaseModel`。
- `UploadForm` 继承 `BaseModel`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import base64`；`import json`；`import logging`。
- 模块级配置或常量名称：`FILE_API_PREFIX`, `MAX_UPLOAD_COUNT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/container_file_http.py#L1-L1078)。
- **`jiuwenswarm/gateway/channel_manager/web/git_ws_handler.py`**
- 源码对模块职责的说明：GitDiffWebSocketHandler: /ws/git 路由的消息分发与推送(设计文档 §2.6 / §4.2)。。
- `GitDiffWebSocketHandler` 定义类型边界；方法入口：`__init__`, `handle_connection`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import time`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/git_ws_handler.py#L1-L596)。
- **`jiuwenswarm/gateway/channel_manager/web/lifecycle_handlers.py`**
- 源码对模块职责的说明：Gateway lifecycle orchestration: archive checks state; deletion stops work.。
- 调用入口 `register_lifecycle_handlers(channel, resolve_client, resolve_cron)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from jiuwenswarm.common.schema.message import ReqMethod`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/lifecycle_handlers.py#L1-L172)。
- **`jiuwenswarm/gateway/channel_manager/web/task_asr.py`**
- 源码对模块职责的说明：OpenAI-compatible ASR used by the regular task chat composer.。
- `TaskAsrError` 继承 `RuntimeError`；方法入口：`__init__`。
- 调用入口 `task_asr_endpoint(api_base)`；声明返回 `str`。
- 异步入口 `transcribe_task_audio(params, environ, client)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import base64`；`import binascii`；`import os`。
- 模块级配置或常量名称：`MAX_TASK_ASR_AUDIO_BYTES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/task_asr.py#L1-L173)。
- **`jiuwenswarm/gateway/channel_manager/web/trajectory_http.py`**
- 源码对模块职责的说明：Gateway HTTP read API for persisted single-Agent trajectory records.。
- `TrajectoryHttpService` 定义类型边界；方法入口：`__init__`, `settings`, `reader`, `list_subjects`, `export_archive`, `get_session_usage`。
- 调用入口 `attach_trajectory_routes(app, channel, settings, reader, metadata_loader)`；声明返回 `TrajectoryHttpService`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import io`；`import json`。
- 模块级配置或常量名称：`TRAJECTORY_API_PREFIX`, `TRAJECTORY_ARCHIVE_ENTRY_NAME`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/trajectory_http.py#L1-L970)。
- **`jiuwenswarm/gateway/channel_manager/web/web_connect.py`**
- 源码对模块职责的说明：WebChannel - WebSocket 通道实现.。
- `WebChannelConfig` 定义类型边界。
- `WebChannel` 继承 `BaseWsChannel`；方法入口：`__init__`, `clients`, `register_method`, `unregister_method`, `on_message`, `wrap_message_callback`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import inspect`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/web_connect.py#L1-L1838)。
- **`jiuwenswarm/gateway/channel_manager/web/web_http_auth.py`**
- 源码对模块职责的说明：Gateway Web HTTP 的登录路由（''/api/v1/auth/*''），华为账号 Account Kit。。
- `AuthClaimBody` 继承 `BaseModel`。
- `AuthCallbackQuery` 继承 `BaseModel`。
- 调用入口 `resolve_session_id(request)`；声明返回 `str / None`。
- 调用入口 `register_auth_routes(app)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import html`；`import logging`；`from typing import Annotated`。
- 模块级配置或常量名称：`AUTH_SESSION_COOKIE`, `AUTH_SESSION_HEADER`, `AUTH_CALLBACK_CHANNEL`, `AUTH_CALLBACK_MESSAGE`, `AUTH_REQUEST_HEADER`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/web_http_auth.py#L1-L349)。
- **`jiuwenswarm/gateway/channel_manager/web/ws_connection_adapter.py`**
- 源码对模块职责的说明：Adapt Starlette WebSocket to the websockets-like surface WebChannel expects.。
- `StarletteWsAdapter` 定义类型边界；方法入口：`__init__`, `closed`, `state`, `accept`, `send`, `recv`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketS`；`from websockets.exceptions import ConnectionClosed, ConnectionClosedError, `。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/ws_connection_adapter.py#L1-L116)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/gateway-channel-manager/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
