---
name: agent-server-runtime-utils-contracts-01
description: utils 源码接口与集成边界 01：jiuwenswarm/server/utils 下 diff_service.py（DiffService、get_diff_service）、stream_utils.py、utils.py 三个模块的静态声明
metadata:
  scope: 只收utils 目录三个模块的静态声明，不证明运行行为；入口说明归 agent-server-runtime-utils-overview
---
# utils 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/utils/diff_service.py`**
- 源码对模块职责的说明：Turn-based diff service for /diff command.。
- `DiffHistoryExpiredError` 继承 `RuntimeError`。
- `DiffService` 定义类型边界；方法入口：`__init__`, `get_turn_diffs`, `turn_matches_history_record`, `get_turn_diff_summaries`, `get_turn_diff`, `mark_turn_discarded`。
- 调用入口 `get_diff_service()`；声明返回 `DiffService`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import difflib`；`import copy`；`import json`。
- 模块级配置或常量名称：`INTERNAL_UNTRACKED_DIRS`, `MAX_FILES`, `MAX_DIFF_SIZE_BYTES`, `MAX_FILES_FOR_DETAILS`, `HISTORY_PRIORITY_PROJECT_ROOT`, `HISTORY_PRIORITY_SHARED_WORKSPACE`, `HISTORY_PRIORITY_EXTRA_ROOT`, `HISTORY_PRIORITY_UNKNOWN`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/diff_service.py#L1-L2645)。
- **`jiuwenswarm/server/utils/stream_utils.py`**
- 源码对模块职责的说明：Stream utilities for parsing agent output chunks.。
- 调用入口 `normalize_context_usage_payload(payload)`；声明返回 `dict[str, Any] / None`。
- 调用入口 `parse_stream_chunk(chunk, _has_streamed_content)`；声明返回 `dict[str, Any] / None`。
- 调用入口 `parse_ask_user_question_payload(payload)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import math`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/stream_utils.py#L1-L690)。
- **`jiuwenswarm/server/utils/utils.py`**
- 源码对模块职责的说明：AgentServer 工具函数.。
- 调用入口 `get_chat_id(request)`；声明返回 `str / None`。
- 调用入口 `is_team_params(params)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from typing import Any, Mapping`；`from jiuwenswarm.common.schema.agent import AgentRequest`；`from jiuwenswarm.common.mode_matrix import is_team_mode`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/utils.py#L1-L41)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/utils/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
