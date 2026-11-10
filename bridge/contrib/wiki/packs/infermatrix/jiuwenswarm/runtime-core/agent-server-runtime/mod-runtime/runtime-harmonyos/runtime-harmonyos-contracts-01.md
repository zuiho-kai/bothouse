---
name: runtime-harmonyos-contracts-01
description: runtime-harmonyos 源码接口与集成边界 01：jiuwenswarm/server/runtime/harmonyos 下 harmonyos_dev.py 与 harmonyos_project.py 两个文件的静态声明
metadata:
  scope: 只收 harmonyos 目录两个文件的静态声明，不证明运行行为；入口说明归 runtime-harmonyos-overview
---
# runtime-harmonyos 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/harmonyos/harmonyos_dev.py`**
- 源码对模块职责的说明：DevEco CLI bootstrap support for the TUI channel.。
- 异步入口 `run_harmonyos_project_init(params)`；声明返回 `dict[str, Any]`。
- `CommandResult` 定义类型边界；方法入口：`to_dict`。
- 异步入口 `run_harmonyos_dev_init(params)`；声明返回 `dict[str, Any]`。
- 异步入口 `detect_executable(name, version_command)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import contextlib`；`import hashlib`。
- 模块级配置或常量名称：`DEFAULT_COMMAND_TIMEOUT_SECONDS`, `INSTALL_TIMEOUT_SECONDS`, `UPDATE_TIMEOUT_SECONDS`, `INIT_TIMEOUT_SECONDS`, `COMMAND_TERMINATION_TIMEOUT_SECONDS`, `MAX_COMMAND_OUTPUT_BYTES`, `COMMAND_OUTPUT_READ_CHUNK_BYTES`, `MIN_NODE_MAJOR_VERSION`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/harmonyos/harmonyos_dev.py#L1-L836)。
- **`jiuwenswarm/server/runtime/harmonyos/harmonyos_project.py`**
- 源码对模块职责的说明：TUI-only HarmonyOS project inspection and persisted Agent context.。
- `HarmonyOSProjectError` 继承 `ValueError`。
- 调用入口 `inspect_harmonyos_project(project_path)`；声明返回 `dict[str, Any]`。
- 调用入口 `persist_harmonyos_project_context(context)`；声明返回 `Path`。
- 调用入口 `load_harmonyos_project_context(project_path, allow_stale)`；声明返回 `dict[str, Any] / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import json`；`import os`。
- 模块级配置或常量名称：`SCHEMA_VERSION`, `MAX_DESCRIPTOR_BYTES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/harmonyos/harmonyos_project.py#L1-L773)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-harmonyos/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
