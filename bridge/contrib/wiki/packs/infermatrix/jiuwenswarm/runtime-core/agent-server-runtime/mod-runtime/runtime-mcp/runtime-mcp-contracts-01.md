---
name: runtime-mcp-contracts-01
description: runtime-mcp 源码接口与集成边界 01：jiuwenswarm/server/runtime/mcp 下 __init__、call_timeout_patch、cli_driver、credential、exc_group、marketplace、package_manifest、paths、registry、skill_installer、state_store 共十一个文件的静态声明
metadata:
  scope: 只收 mcp 目录十一个文件的静态声明，不证明运行行为；入口说明归 runtime-mcp-overview
---
# runtime-mcp 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/mcp/__init__.py`**
- 源码对模块职责的说明：MCP runtime package: marketplace registry, CLI driver, credential store, skill installer, connection state store.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.server.runtime.mcp.registry import build_config_entry, com`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/__init__.py#L1-L29)。
- **`jiuwenswarm/server/runtime/mcp/call_timeout_patch.py`**
- 源码对模块职责的说明：Inject a per-call timeout into openjiuwen's MCP HTTP clients.。
- 调用入口 `apply_mcp_call_timeout_patch(default_timeout)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`import anyio`；`from openjiuwen.core.common.logging import logger`。
- 模块级配置或常量名称：`DEFAULT_CALL_TIMEOUT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/call_timeout_patch.py#L1-L197)。
- **`jiuwenswarm/server/runtime/mcp/cli_driver.py`**
- 源码对模块职责的说明：CLI driver.。
- 调用入口 `cancel_pending_auth_proc(name)`；声明返回 `None`。
- `CommandResult` 定义类型边界；方法入口：`succeeded`, `combined_output`。
- 调用入口 `default_runner(command, timeout, env)`；声明返回 `CommandResult`。
- `CliManifest` 定义类型边界；方法入口：`from_dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`import platform`。
- 模块级配置或常量名称：`ERR_BINARY_NOT_FOUND`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/cli_driver.py#L1-L790)。
- **`jiuwenswarm/server/runtime/mcp/credential.py`**
- 源码对模块职责的说明：MCP credential layer.。
- 调用入口 `extract_placeholders(mcp_cfg)`；声明返回 `set[str]`。
- 调用入口 `load_token_schema(name)`；声明返回 `dict[str, Any] / None`。
- 调用入口 `required_tokens_from_schema(name)`；声明返回 `list[str]`。
- 调用入口 `build_credentials_prompt(name, missing_tokens)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import base64`；`import json`；`import logging`。
- 模块级配置或常量名称：`KIND_NONE`, `KIND_TOKEN`, `KIND_CLI_OAUTH`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/credential.py#L1-L461)。
- **`jiuwenswarm/server/runtime/mcp/exc_group.py`**
- 源码对模块职责的说明：Convert anyio/BaseExceptionGroup escapes from the MCP SDK into exceptions that ordinary ''except Exception'' blocks can catch.。
- 调用入口 `reraise_as_exception(exc)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/exc_group.py#L1-L115)。
- **`jiuwenswarm/server/runtime/mcp/marketplace.py`**
- 源码对模块职责的说明：SkillHub-backed MCP package catalog and install lifecycle.。
- 异步入口 `list_mcps_with_hub(mcp_filter, hub_port, cache_mode, refresh, query)`；声明返回 `list[dict[str, Any]]`。
- 异步入口 `show_mcp_with_hub(identifier, hub_port)`；声明返回 `dict[str, Any] / None`。
- 异步入口 `install_hub_mcp(asset_id, hub_port, downloader)`；声明返回 `dict[str, Any]`。
- 调用入口 `uninstall_hub_mcp(identifier)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import shutil`；`from pathlib import Path, PureWindowsPath`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/marketplace.py#L1-L304)。
- **`jiuwenswarm/server/runtime/mcp/package_manifest.py`**
- 源码对模块职责的说明：Validated, manifest-driven access to an MCP asset package.。
- `McpPackageError` 继承 `ValueError`。
- `McpPackageManifest` 定义类型边界。
- 调用入口 `load_mcp_package(package_dir, expected_id)`；声明返回 `McpPackageManifest`。
- 调用入口 `iter_mcp_packages(*package_roots)`；声明返回 `list[McpPackageManifest]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/package_manifest.py#L1-L283)。
- **`jiuwenswarm/server/runtime/mcp/paths.py`**
- 源码对模块职责的说明：Shared utility helpers for the MCP runtime — things that don't touch the filesystem layout (''_mcp_root'' / ''_packages_dir'') so they can be imported by any mo。
- 调用入口 `load_json(path)`；声明返回 `dict[str, Any] / None`。
- 调用入口 `has_skill_file(directory)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/paths.py#L1-L33)。
- **`jiuwenswarm/server/runtime/mcp/registry.py`**
- 源码对模块职责的说明：MCP marketplace registry.。
- `CliConnectError` 继承 `ValueError`；方法入口：`__init__`。
- `McpRegistryError` 继承 `ValueError`；方法入口：`__init__`。
- 调用入口 `resolve_package(name)`；声明返回 `McpPackageManifest / None`。
- 调用入口 `is_stale_marketplace_record(name, record)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from pathlib import Path`；`from typing import Any`。
- 模块级配置或常量名称：`CODE_RUNTIME_MISSING`, `CODE_INSTALL_NETWORK`, `CODE_CLI_INCOMPLETE`, `CODE_NAME_CONFLICT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/registry.py#L1-L1481)。
- **`jiuwenswarm/server/runtime/mcp/skill_installer.py`**
- 源码对模块职责的说明：MCP skill installer.。
- 调用入口 `install_mcp_skills(name)`；声明返回 `dict[str, Any]`。
- 调用入口 `uninstall_mcp_skills(name)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import re`；`import shutil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/skill_installer.py#L1-L219)。
- **`jiuwenswarm/server/runtime/mcp/state_store.py`**
- 源码对模块职责的说明：MCP connection state store.。
- 调用入口 `read_mcp_state()`；声明返回 `dict[str, Any]`。
- 调用入口 `get_mcp_record(name)`；声明返回 `dict[str, Any] / None`。
- 调用入口 `list_connected_mcps()`；声明返回 `list[dict[str, Any]]`。
- 调用入口 `list_truly_connected_mcps()`；声明返回 `list[dict[str, Any]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import threading`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/mcp/state_store.py#L1-L425)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-mcp/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
