---
name: video-duplex-backend-contracts-02
description: video-duplex-backend 源码接口与集成边界 02：backend 的 tasks/server_adapter（VoiceTaskServerAdapter）、tasks/service（TaskService）、tasks/store（TaskStore）、video_live、video_search、video_voice 声明
metadata:
  scope: 只收 description 所列 backend 六个文件的静态声明；其余 backend 文件归 video-duplex-backend-contracts-01，入口说明归 video-duplex-backend-overview
---
# video-duplex-backend 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/extensions/video_duplex/backend/tasks/server_adapter.py`**
- 源码对模块职责的说明：AgentServer endpoints for checkpoint ACKs and task-produced files.。
- `VoiceTaskServerAdapter` 继承 `GatewayAdapter`；方法入口：`handle`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import asyncio`；`import re`；`from jiuwenswarm.common.schema.agent import AgentResponse`；`from jiuwenswarm.common.schema.message import ReqMethod`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/server_adapter.py#L1-L52)。
- **`jiuwenswarm/extensions/video_duplex/backend/tasks/service.py`**
- 源码对模块职责的说明：Durable user tasks over an injected Agent executor, independent of media/RPC.。
- `TaskModification` 定义类型边界。
- `ExecutionUncertain` 继承 `RuntimeError`。
- `InteractionPending` 继承 `RuntimeError`。
- `TaskService` 定义类型边界；方法入口：`__init__`, `start`, `kick`, `submit`, `get`, `list`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import asyncio`；`import hashlib`；`import json`；`import logging`。
- 模块级配置或常量名称：`TERMINAL`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L1-L798)。
- **`jiuwenswarm/extensions/video_duplex/backend/tasks/store.py`**
- 源码对模块职责的说明：One SQLite record of task facts and idempotent user operations.。
- 调用入口 `task_database()`。
- 调用入口 `encode(value)`。
- `TaskStore` 定义类型边界；方法入口：`__init__`, `transaction`, `get`, `put`, `rows`, `replay`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from contextlib import contextmanager`；`import hashlib`；`import json`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/store.py#L1-L124)。
- **`jiuwenswarm/extensions/video_duplex/backend/video_live.py`**
- 源码对模块职责的说明：Jiuwen Web RPC for short-window realtime audio-video Q&A.。
- 调用入口 `video_duplex_enabled()`；声明返回 `bool`。
- 调用入口 `register_video_live_handler(channel, agent_client, normalize_media_attachments)`；声明返回 `video_search.VideoSearchManager`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`from datetime import datetime, timezone`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L1-L698)。
- **`jiuwenswarm/extensions/video_duplex/backend/video_search.py`**
- 源码对模块职责的说明：Core Agent execution and asynchronous search jobs for video-live sessions.。
- 调用入口 `core_agent_brief_protocol(nonce)`；声明返回 `str`。
- 调用入口 `present_core_agent_result(raw_answer, nonce, question, tools_used)`；声明返回 `dict[str, Any]`。
- 调用入口 `core_agent_text(value, limit)`；声明返回 `str`。
- 调用入口 `core_agent_progress(payload)`；声明返回 `dict[str, Any] / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import re`。
- 模块级配置或常量名称：`VIDEO_TOOL_CHANNEL_ID`, `MAX_FRAME_CHARS`, `MAX_DELEGATION_CONTEXT_ITEMS`, `MAX_DELEGATION_CONTEXT_CHARS`, `MAX_DELEGATION_RESULT_CHARS`, `MAX_REALTIME_BRIEF_CHARS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_search.py#L1-L539)。
- **`jiuwenswarm/extensions/video_duplex/backend/video_voice.py`**
- 源码对模块职责的说明：ASR and TTS adapters shared by video-live providers.。
- 调用入口 `is_allowed_audio_data_url(value)`；声明返回 `bool`。
- 调用入口 `tts_model_config()`；声明返回 `tuple[str, str, str, str]`。
- 调用入口 `asr_model_config()`；声明返回 `tuple[str, str, str]`。
- 调用入口 `clean_model_text(text)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import base64`；`import os`。
- 模块级配置或常量名称：`MAX_AUDIO_CHARS`, `MAX_TTS_TEXT_CHARS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_voice.py#L1-L558)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/video-duplex-backend/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
