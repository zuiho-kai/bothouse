---
name: channels-process-cli-contracts-01
description: channels-process-cli 源码接口与集成边界 01：process_cli 下 commands、control_commands、display_context、duplex_control、duplex_input、duplex_protocol、live_input、live_layout、machine_entry、machine_io、machine_result、machine_signals、main 共十三个文件的静态声明
metadata:
  scope: 只收这十三个文件的类型、函数、导入与常量名称声明，不证明运行行为；prompt、protocol 子包、query、render、ui 归 channels-process-cli-contracts-02；入口说明归 channels-process-cli-overview
---
# channels-process-cli 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/process_cli/commands.py`**
- 源码对模块职责的说明：Local slash-command registry for the process-style CLI.。
- `SlashCommand` 定义类型边界。
- `ParsedSlashCommand` 定义类型边界。
- `SlashCommandArgument` 定义类型边界。
- 调用入口 `resolve_slash_command(value)`；声明返回 `str / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`。
- 模块级配置或常量名称：`MODE_ARGUMENTS`, `SLASH_COMMANDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/commands.py#L1-L166)。
- **`jiuwenswarm/channels/process_cli/control_commands.py`**
- 源码对模块职责的说明：Read-only Runtime queries and presentation for interactive CLI controls.。
- `ControlQueryError` 继承 `RuntimeError`。
- 异步入口 `query_runtime(operation, cwd, params, timeout)`；声明返回 `dict[str, Any]`。
- 调用入口 `show_sessions(ui, data, current, search)`；声明返回 `tuple[str, ...]`。
- 调用入口 `show_models(ui, data, selected)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/control_commands.py#L1-L222)。
- **`jiuwenswarm/channels/process_cli/display_context.py`**
- 源码对模块职责的说明：Lightweight display metadata for the process-style CLI shell.。
- 调用入口 `select_configured_model_name(entries, dotenv)`；声明返回 `str / None`。
- 调用入口 `resolve_configured_model_name()`；声明返回 `str`。
- 调用入口 `resolve_display_mode(mode, work_mode)`；声明返回 `str`。
- 调用入口 `resolve_cli_work_mode(mode, work_mode)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`import re`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/display_context.py#L1-L260)。
- **`jiuwenswarm/channels/process_cli/duplex_control.py`**
- 源码对模块职责的说明：Per-command stdio control routing; execution and approvals stay in Runtime.。
- `DuplexControlError` 继承 `ValueError`；方法入口：`__init__`。
- `DuplexController` 定义类型边界；方法入口：`__init__`, `start`, `consume`, `stop_input`, `close_streams`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import builtins`；`import uuid`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/duplex_control.py#L1-L313)。
- **`jiuwenswarm/channels/process_cli/duplex_input.py`**
- 源码对模块职责的说明：Cancellable, bounded UTF-8 line input for one duplex command process.。
- `DuplexInputError` 继承 `ValueError`。
- `DuplexLineReader` 定义类型边界；方法入口：`__init__`, `closed`, `buffered_bytes`, `read_line`, `read_document`, `close`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import io`；`import math`。
- 模块级配置或常量名称：`MAX_DUPLEX_LINE_BYTES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/duplex_input.py#L1-L310)。
- **`jiuwenswarm/channels/process_cli/duplex_protocol.py`**
- 源码对模块职责的说明：Strict transport-only answer/cancel records for one duplex command.。
- `DuplexProtocolError` 继承 `ValueError`；方法入口：`__init__`。
- `DuplexControl` 定义类型边界；方法入口：`to_dict`。
- 调用入口 `decode_control(line)`；声明返回 `DuplexControl`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import math`；`from dataclasses import dataclass`；`from typing import Any, Literal`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/duplex_protocol.py#L1-L190)。
- **`jiuwenswarm/channels/process_cli/live_input.py`**
- 源码对模块职责的说明：Human TTY supplemental input for one Process CLI Runtime worker.。
- `LiveInputReceipt` 定义类型边界。
- 调用入口 `encode_forwarded_receipt(receipt)`；声明返回 `str`。
- `TtyLineReader` 定义类型边界；方法入口：`__init__`, `close`。
- `PipeLineReader` 定义类型边界；方法入口：`__init__`, `close`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import time`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/live_input.py#L1-L398)。
- **`jiuwenswarm/channels/process_cli/live_layout.py`**
- 源码对模块职责的说明：Parent-owned live turn layout for the interactive Process CLI.。
- `LiveTurnLayout` 定义类型边界；方法入口：`__init__`, `bind`, `add_supplement`, `add_notice`, `apply_receipt`, `append_output`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from typing import Literal`；`from prompt_toolkit import PromptSession`。
- 模块级配置或常量名称：`FORWARDED_RECEIPT_PREFIX`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/live_layout.py#L1-L136)。
- **`jiuwenswarm/channels/process_cli/machine_entry.py`**
- 源码对模块职责的说明：Lightweight machine bootstrap; import Runtime only after stdout/cwd setup.。
- 调用入口 `protocol_stdout()`；声明返回 `Iterator[TextIO]`。
- 调用入口 `prepare_workspace(run_input)`；声明返回 `_Input`。
- 调用入口 `execute_source(source, conflicting_arguments, json_lines)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import builtins`；`import contextlib`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine_entry.py#L1-L252)。
- **`jiuwenswarm/channels/process_cli/machine_io.py`**
- 源码对模块职责的说明：Bounded one-document input and streaming output for the machine CLI.。
- `MachineInputError` 继承 `ValueError`；方法入口：`__init__`。
- 调用入口 `decode_machine_document(document)`；声明返回 `dict[str, Any]`。
- 调用入口 `read_run_input(source, stdin)`；声明返回 `OneShotRunInput`。
- 调用入口 `read_machine_document(source, stdin)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import sys`；`from dataclasses import replace`。
- 模块级配置或常量名称：`MAX_RUN_INPUT_BYTES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine_io.py#L1-L258)。
- **`jiuwenswarm/channels/process_cli/machine_result.py`**
- 源码对模块职责的说明：Reduce a one-shot Runtime stream without retaining its event history.。
- `RunSummary` 定义类型边界；方法入口：`__init__`, `output`, `usage`, `error`, `observe`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import math`；`from collections.abc import Mapping`；`from copy import deepcopy`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine_result.py#L1-L183)。
- **`jiuwenswarm/channels/process_cli/machine_signals.py`**
- 源码对模块职责的说明：Signal ownership for one machine invocation, including input and shutdown.。
- `CommandSignals` 定义类型边界；方法入口：`__init__`, `interrupt`, `run`, `finalize`。
- 调用入口 `command_signals()`；声明返回 `Iterator[CommandSignals]`。
- 调用入口 `defer_command_signals()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import contextlib`；`import signal`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine_signals.py#L1-L105)。
- **`jiuwenswarm/channels/process_cli/main.py`**
- 源码对模块职责的说明：Entry point for the process-style JiuwenSwarm CLI.。
- `ChineseArgumentParser` 继承 `argparse.ArgumentParser`；方法入口：`format_usage`, `format_help`, `error`。
- 调用入口 `build_parser()`；声明返回 `argparse.ArgumentParser`。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import asyncio`；`import contextlib`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/main.py#L1-L337)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/channels-process-cli/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
