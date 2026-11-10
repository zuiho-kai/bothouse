---
name: packaging-deploy-scripts-contracts-02
description: scripts/ 的 update_playwright_mcp_runtime 与 verify_a2ui、gitcode_cli、playwright_mcp、rsi 校验脚本的源码接口与集成边界
metadata:
  scope: 只收 update/verify 类脚本；构建与入口脚本归 packaging-deploy-scripts-contracts-01-1、packaging-deploy-scripts-contracts-01-2
---
# scripts 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`scripts/update_playwright_mcp_runtime.py`**
- 源码对模块职责的说明：Build the reproducible, browser-free Playwright MCP runtime archive.。
- 调用入口 `build(npm_executable, node_executable)`；声明返回 `None`。
- 调用入口 `main()`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import hashlib`；`import json`。
- 模块级配置或常量名称：`LOGGER`, `PROJECT_ROOT`, `SOURCE_DIR`, `RESOURCE_DIR`, `PACKAGE_NAME`, `PACKAGE_VERSION`, `MINIMUM_NODE_VERSION`, `CLI_RELATIVE_PATH`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/update_playwright_mcp_runtime.py#L1-L289)。
- **`scripts/verify_a2ui_bundle.py`**
- 源码对模块职责的说明：Verify that a frozen JiuwenSwarm build can initialize A2UI v0.8.。
- 调用入口 `verify_a2ui_bundle()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import sys`；`from importlib.resources import files`。
- 模块级配置或常量名称：`LOGGER`, `EXPECTED_PROTOCOL_VERSION`, `REQUIRED_ASSET_FILENAMES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/verify_a2ui_bundle.py#L1-L47)。
- **`scripts/verify_gitcode_cli_bundle.py`**
- 源码对模块职责的说明：Verify the GitCode CLI binary packaged inside a frozen build.。
- 调用入口 `verify_gitcode_cli_bundle()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import shutil`；`import subprocess`。
- 模块级配置或常量名称：`LOGGER`, `EXPECTED_VERSION`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/verify_gitcode_cli_bundle.py#L1-L53)。
- **`scripts/verify_playwright_mcp_bundle.py`**
- 源码对模块职责的说明：Verify Node and the packaged Playwright MCP CLI in a frozen build.。
- 调用入口 `verify_playwright_mcp_bundle()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import subprocess`；`import sys`。
- 模块级配置或常量名称：`LOGGER`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/verify_playwright_mcp_bundle.py#L1-L54)。
- **`scripts/verify_playwright_mcp_offline.py`**
- 源码对模块职责的说明：Offline Playwright MCP smoke test using managed Chrome over CDP.。
- 调用入口 `verify(node_path, chrome_path)`；声明返回 `int`。
- 调用入口 `main()`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import asyncio`；`import contextlib`。
- 模块级配置或常量名称：`LOGGER`, `EXPECTED_TOOLS`, `ALL_CAPABILITIES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/verify_playwright_mcp_offline.py#L1-L249)。
- **`scripts/verify_rsi_bundle.py`**
- 源码对模块职责的说明：Verify a frozen Desktop build includes the RSI native Harness baseline.。
- 调用入口 `verify_rsi_bundle()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import sys`；`from pathlib import Path`。
- 模块级配置或常量名称：`LOGGER`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/verify_rsi_bundle.py#L1-L39)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/packaging-deploy/scripts/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
