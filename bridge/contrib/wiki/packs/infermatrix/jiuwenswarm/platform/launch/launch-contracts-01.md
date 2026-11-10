---
name: launch-contracts-01
description: launch 源码接口与集成边界 01：debug_launcher.py、llm_provider_compat_patch.py、llm_sse_patch.py 的逐文件静态声明记录与源码链接
metadata:
  scope: 只收这三个文件的逐文件静态声明；启动入口语义归 jiuwenswarm，导航归 launch-overview
---
# launch 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/debug_launcher.py`**
- 源码对模块职责的说明：One-command local debug launcher for JiuWenSwarm.。
- `DebugState` 定义类型边界；方法入口：`to_dict`, `from_dict`。
- 调用入口 `get_debug_log_dir()`；声明返回 `Path`。
- 调用入口 `get_debug_state_path()`；声明返回 `Path`。
- 调用入口 `build_debug_log_path(now)`；声明返回 `Path`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import os`。
- 模块级配置或常量名称：`PACKAGE_DIR`, `REPO_ROOT`, `WEB_DEV_DIR`, `DEBUG_LOG_DIRNAME`, `DEBUG_STATE_FILENAME`, `DEBUG_LOG_PREFIX`, `DEBUG_LOG_SUFFIX`, `DEFAULT_STOP_TIMEOUT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/debug_launcher.py#L1-L906)。
- **`jiuwenswarm/llm_provider_compat_patch.py`**
- 源码对模块职责的说明：Runtime compatibility fixes for provider-specific OpenAI/Anthropic dialects.。
- 调用入口 `apply_provider_compat_patches()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from collections.abc import Mapping`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/llm_provider_compat_patch.py#L1-L128)。
- **`jiuwenswarm/llm_sse_patch.py`**
- 源码对模块职责的说明：Runtime patch: make non-streaming OpenAI invoke() tolerate SSE-only gateways.。
- 调用入口 `assemble_openai_response(response)`；声明返回 `Any`。
- 调用入口 `apply_openai_sse_invoke_patch()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import time`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/llm_sse_patch.py#L1-L188)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
