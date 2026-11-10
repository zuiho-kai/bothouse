---
name: runtime-session-contracts-02
description: runtime-session 源码接口与集成边界 02：session 目录 session_history、session_info、session_manager、session_message_service、session_message_store、session_metadata、session_rename、work_mode 八个文件的静态声明
metadata:
  scope: 只收 session 目录最后八个文件的静态声明，不证明运行行为；git_diff_status 到 session_archive 的十三个文件归 runtime-session-contracts-01，规则归 runtime-session-rules，入口说明归 runtime-session-overview
---
# runtime-session 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/session/session_history.py`**
- `InvalidHistoryCursor` 继承 `ValueError`。
- `HistorySnapshotChanged` 继承 `RuntimeError`。
- 调用入口 `collapse_file_content_blocks(content)`；声明返回 `str`。
- 调用入口 `subagent_history_dir_name(subagent_id)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import base64`；`import datetime`。
- 模块级配置或常量名称：`SESSION_REQUEST_COMPLETED_EVENT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/session_history.py#L1-L1308)。
- **`jiuwenswarm/server/runtime/session/session_info.py`**
- 源码对模块职责的说明：会话对外信息（SessionInfo）投影：会话元数据 → 面向 Web/TUI 消费的字段。。
- 调用入口 `to_session_info(meta)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from jiuwenswarm.common.work_mode import DEFAULT_WEB_WORK_MODE`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/session_info.py#L1-L49)。
- **`jiuwenswarm/server/runtime/session/session_manager.py`**
- 源码对模块职责的说明：Session Manager - 管理 session 任务队列和并发控制.。
- `SessionManager` 定义类型边界；方法入口：`__init__`, `get_session_id`, `cancel_session_task`, `cancel_all_session_tasks`, `close_session`, `close_all_sessions`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import contextvars`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/session_manager.py#L1-L402)。
- **`jiuwenswarm/server/runtime/session/session_message_service.py`**
- 源码对模块职责的说明：AgentServer-owned orchestration for cross-Session Agent messages.。
- `SessionMessagingError` 继承 `RuntimeError`；方法入口：`__init__`。
- `SessionMessageSource` 定义类型边界。
- `SessionMessageExecutionResult` 定义类型边界。
- `SessionMessageService` 定义类型边界；方法入口：`__init__`, `store`, `start`, `stop`, `set_available`, `list_targets`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import sqlite3`。
- 模块级配置或常量名称：`MAX_SESSION_MESSAGE_BYTES`, `MAX_SESSION_MESSAGE_HOPS`, `EXECUTION_WATCHDOG_TIMEOUT_SECONDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/session_message_service.py#L1-L1255)。
- **`jiuwenswarm/server/runtime/session/session_message_store.py`**
- 源码对模块职责的说明：Durable mailbox for Agent-to-Agent product Session messages.。
- `SessionMessageStoreError` 继承 `RuntimeError`。
- `SessionMessageLimitExceeded` 继承 `SessionMessageStoreError`。
- `SessionMessageIdempotencyConflict` 继承 `SessionMessageStoreError`。
- `SessionMessageRecord` 定义类型边界；方法入口：`to_dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import sqlite3`；`import threading`；`import time`。
- 模块级配置或常量名称：`ACTIVE_SESSION_MESSAGE_STATUSES`, `TERMINAL_SESSION_MESSAGE_STATUSES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/session_message_store.py#L1-L968)。
- **`jiuwenswarm/server/runtime/session/session_metadata.py`**
- 源码对模块职责的说明：会话元数据管理模块。
- 调用入口 `flush_pending_writes(timeout)`；声明返回 `bool`。
- 调用入口 `init_session_metadata(session_id, channel_id, user_id, title, mode, team_name, team_template_id, project_dir, project_id, persist_session, …)`；声明返回 `None`。
- 调用入口 `update_session_metadata(session_id, channel_id, user_id, title, clear_title, increment_message_count, set_message_count, user_content, channel_metadata, mode, …)`；声明返回 `None`。
- 调用入口 `sync_session_request_metadata(session_id, channel_id, mode, model, project_dir, project_id, cron_id, user_id, last_user_message_at, is_chat_turn, …)`；声明返回 `str / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import copy`；`from concurrent.futures import Future`；`from dataclasses import dataclass`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/session_metadata.py#L1-L2060)。
- **`jiuwenswarm/server/runtime/session/session_rename.py`**
- 源码对模块职责的说明：session.rename 共享实现：AgentWebSocketServer 与 cli_channel 本地回退共用。。
- 调用入口 `apply_session_rename(params, connection_session_id, init_channel_id)`；声明返回 `tuple[bool, dict[str, Any] / None, str / None, str / None]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/session_rename.py#L1-L69)。
- **`jiuwenswarm/server/runtime/session/work_mode.py`**
- 源码对模块职责的说明：工作模式（work_mode）高层 helper。。
- 调用入口 `default_work_mode_for_channel(channel_id)`；声明返回 `str`。
- 调用入口 `infer_legacy_project_work_mode(raw_project)`；声明返回 `str`。
- 调用入口 `resolve_request_work_mode(params, channel_id)`；声明返回 `tuple[str / None, str / None]`。
- `SessionWorkModeParams` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from typing import Any`；`from jiuwenswarm.common.work_mode import DEFAULT_PROJECT_ID_CODE, DEFAULT_P`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/work_mode.py#L1-L179)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-session/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
