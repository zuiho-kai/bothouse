---
name: packaging-deploy-scripts-contracts-01-2
description: scripts/ 构建脚本源码接口第 2 部分：build_python_packages、build_tui、harmony_entry、installer/iss、jiuwenswarm.spec、exe 入口、reset_trajectory_data
metadata:
  scope: 只收 build_python_packages.py 起的脚本；之前的构建脚本归 packaging-deploy-scripts-contracts-01-1，verify 与 playwright 脚本归 packaging-deploy-scripts-contracts-02
---
# scripts 源码接口与集成边界 01（2/2）

## 现状

- 拆分说明：本页是源页 `source-contracts-01.md` 的第 2/2 部分；第 1 部分 [[packaging-deploy-scripts-contracts-01-1]]
- **`scripts/build_python_packages.py`**
- 调用入口 `run(cmd, cwd, env)`；声明返回 `None`。
- 调用入口 `remove_path(path)`；声明返回 `None`。
- 调用入口 `clean_root()`；声明返回 `None`。
- 调用入口 `clean_sidecar()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import os`。
- 模块级配置或常量名称：`ROOT`, `SIDECAR_ROOT`, `SIDE_CAR_DIST`, `JIUWENBOX_ROOT`, `JIUWENBOX_DIST`, `TUI_ROOT`, `TUI_TARGETS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build_python_packages.py#L1-L231)。
- **`scripts/build_tui.py`**
- 调用入口 `current_platform_key()`；声明返回 `str`。
- 调用入口 `output_binary_name(platform_key)`；声明返回 `str`。
- 调用入口 `resolve_requested_targets(raw)`；声明返回 `list[str]`。
- 调用入口 `build_target(platform_key)`；声明返回 `Path`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import os`。
- 模块级配置或常量名称：`ROOT`, `TUI_ENTRY`, `OUTPUT_ROOT`, `TARGETS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build_tui.py#L1-L135)。
- **`scripts/harmony_entry.py`**
- 源码对模块职责的说明：HarmonyOS entry point for JiuwenSwarm services.。
- 调用入口 `check_tcp_port(host, port)`；声明返回 `bool`。
- 调用入口 `wait_for_tcp_port(host, port, timeout, interval, service_name)`；声明返回 `bool`。
- 调用入口 `find_free_port(start_port)`；声明返回 `int`。
- 调用入口 `start_service(module_path, args, service_name)`；声明返回 `subprocess.Popen`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`import sys`；`import signal`。
- 模块级配置或常量名称：`DEFAULT_AGENTSERVER_PORT`, `DEFAULT_GATEWAY_PORT`, `DEFAULT_FRONTEND_PORT`, `PORT_CHECK_TIMEOUT`, `PORT_CHECK_INTERVAL`, `SERVICE_MONITOR_INTERVAL`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/harmony_entry.py#L1-L365)。
- **`scripts/installer-electron.iss`**
- 源码声明的类型、组件或调用边界：`InitializeSetup`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/installer-electron.iss#L1-L295)。
- **`scripts/installer.iss`**
- 源码声明的类型、组件或调用边界：`HasDescriptionStemInTree`, `HasNestedDescriptionReplacement`, `GetWebView2RuntimeVersion`, `StripQuotes`, `TryRegUninstaller`, `TryFallbackUninstaller`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/installer.iss#L1-L570)。
- **`scripts/jiuwenswarm.iss`**
- 源码声明的类型、组件或调用边界：`UserWorkspaceDir`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/jiuwenswarm.iss#L1-L62)。
- **`scripts/jiuwenswarm.spec`**
- 集成边界的导入/加载声明：`import glob`；`import os`；`import runpy`；`import shutil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/jiuwenswarm.spec#L1-L557)。
- **`scripts/jiuwenswarm_exe_entry.py`**
- 源码对模块职责的说明：PyInstaller 打包入口：根据参数分发到主应用或子命令。。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`import sys`；`import ctypes`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/jiuwenswarm_exe_entry.py#L1-L658)。
- **`scripts/openjiuwen_team_mcp_exe_entry.py`**
- 源码对模块职责的说明：PyInstaller entry point for the bundled OpenJiuWen team MCP server.。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import atexit`；`import os`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/openjiuwen_team_mcp_exe_entry.py#L1-L82)。
- **`scripts/reset_trajectory_data.py`**
- 源码对模块职责的说明：Delete trajectory data written under the previous trajectory contract.。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import glob`；`import shutil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/reset_trajectory_data.py#L1-L118)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/packaging-deploy/scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
