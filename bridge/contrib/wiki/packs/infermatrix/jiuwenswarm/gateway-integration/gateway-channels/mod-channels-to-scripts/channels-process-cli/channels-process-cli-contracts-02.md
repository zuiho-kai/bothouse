---
name: channels-process-cli-contracts-02
description: channels-process-cli 源码接口与集成边界 02：process_cli 下 prompt、protocol 子包（__init__、jsonl、model、query、version）、query、query_entry、render、ui 的静态声明
metadata:
  scope: 只收这些文件的类型、函数、导入与常量名称声明，不证明运行行为；commands 至 main 等文件归 channels-process-cli-contracts-01；入口说明归 channels-process-cli-overview
---
# channels-process-cli 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/process_cli/prompt.py`**
- 源码对模块职责的说明：Interactive prompt with a Codex-style slash-command index.。
- `SlashCommandCompleter` 继承 `Completer`；方法入口：`get_completions`。
- 调用入口 `create_prompt_session(stdin, stdout)`；声明返回 `PromptSession[str] / None`。
- 调用入口 `create_live_prompt_session()`；声明返回 `PromptSession[str]`。
- 异步入口 `read_prompt(session, prompt_text)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import os`；`import sys`。
- 模块级配置或常量名称：`PROMPT_TEXT`, `LIVE_INPUT_PROMPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/prompt.py#L1-L139)。
- **`jiuwenswarm/channels/process_cli/protocol/__init__.py`**
- 源码对模块职责的说明：One-shot, single-Agent machine contracts for the Process CLI.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.channels.process_cli.protocol.jsonl import OneShotRecord, `；`from jiuwenswarm.channels.process_cli.protocol.model import AgentSpec, Json`；`from jiuwenswarm.channels.process_cli.protocol.version import CURRENT_SCHEM`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/protocol/__init__.py#L1-L53)。
- **`jiuwenswarm/channels/process_cli/protocol/jsonl.py`**
- 源码对模块职责的说明：Strict NDJSON codec for one one-shot Process CLI execution.。
- 调用入口 `validate_one_shot_records(records)`；声明返回 `tuple[OneShotRecord, ...]`。
- 调用入口 `encode_jsonl(records)`；声明返回 `str`。
- 调用入口 `encode_jsonl_record(record)`；声明返回 `str`。
- 调用入口 `decode_jsonl(document)`；声明返回 `tuple[OneShotRecord, ...]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from collections.abc import Iterable`；`from typing import TypeAlias`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/protocol/jsonl.py#L1-L137)。
- **`jiuwenswarm/channels/process_cli/protocol/model.py`**
- 源码对模块职责的说明：Value contracts for one Process CLI command and one Runtime lifecycle.。
- `SingleAgentMode` 继承 `str, Enum`。
- `RunStatus` 继承 `str, Enum`。
- `AgentSpec` 定义类型边界；方法入口：`to_dict`, `from_dict`。
- `WorkspaceSpec` 定义类型边界；方法入口：`to_dict`, `from_dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import math`；`import re`；`from collections.abc import Mapping, Sequence`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/protocol/model.py#L1-L748)。
- **`jiuwenswarm/channels/process_cli/protocol/query.py`**
- 源码对模块职责的说明：Strict read-only commands; no Session or Agent is created for a query.。
- `OneShotQueryInput` 定义类型边界；方法入口：`from_dict`。
- `OneShotQueryResult` 定义类型边界；方法入口：`to_dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass, field`；`from typing import Any`；`from jiuwenswarm.channels.process_cli.protocol.model import JsonObject, Run`。
- 模块级配置或常量名称：`QUERY_FIELDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/protocol/query.py#L1-L164)。
- **`jiuwenswarm/channels/process_cli/protocol/version.py`**
- 源码对模块职责的说明：Version marker for the one-shot Process CLI machine schema.。
- 调用入口 `is_schema_version_supported(version)`；声明返回 `bool`。
- 调用入口 `require_supported_schema_version(version)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`。
- 模块级配置或常量名称：`CURRENT_SCHEMA_VERSION`, `SUPPORTED_SCHEMA_VERSIONS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/protocol/version.py#L1-L33)。
- **`jiuwenswarm/channels/process_cli/query.py`**
- 源码对模块职责的说明：Read-only Runtime Public API dispatch for a single query process.。
- 调用入口 `dispatch_query(client, request)`；声明返回 `dict[str, Any]`。
- 调用入口 `query_failure(request_id, code, message, exit_code)`；声明返回 `OneShotQueryResult`。
- 异步入口 `run_query(request, request_id, client_factory)`；声明返回 `OneShotQueryResult`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import builtins`；`import logging`。
- 模块级配置或常量名称：`SHUTDOWN_TIMEOUT_SECONDS`, `CHANNEL_ID`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/query.py#L1-L146)。
- **`jiuwenswarm/channels/process_cli/query_entry.py`**
- 源码对模块职责的说明：Lightweight query bootstrap: validate before importing the Runtime.。
- 调用入口 `execute_query_source(source, conflicting_arguments)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import builtins`；`import io`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/query_entry.py#L1-L118)。
- **`jiuwenswarm/channels/process_cli/render.py`**
- 源码对模块职责的说明：Human, JSON, and JSONL renderers for one Runtime event stream.。
- `EventRenderer` 定义类型边界；方法入口：`__init__`, `start`, `working`, `interrupted`, `prepare_interaction`, `live_input_ready`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import sys`；`from typing import Any, TextIO`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/render.py#L1-L178)。
- **`jiuwenswarm/channels/process_cli/ui.py`**
- 源码对模块职责的说明：Terminal presentation helpers for the process-style CLI.。
- `ProcessCliUI` 定义类型边界；方法入口：`__init__`, `startup`, `help`, `status`, `notice`, `details`。
- `HumanRunUI` 定义类型边界；方法入口：`__init__`, `start`, `working`, `begin_assistant`, `skills`, `clear_status`。
- 调用入口 `resolved_cwd(value)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import os`；`import shutil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/ui.py#L1-L488)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/channels-process-cli/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
