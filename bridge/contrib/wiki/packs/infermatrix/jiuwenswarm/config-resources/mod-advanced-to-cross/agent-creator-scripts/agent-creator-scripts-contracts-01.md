---
name: agent-creator-scripts-contracts-01
description: agent-creator-scripts 源码接口记录 01：agent-creator 技能脚本（模板初始化、注册、分层校验与热加载 worker）；覆盖 init_template.py、register_template.py、validate_hot_load_worker.py、validate_template.py
metadata:
  scope: 只收 agent-creator-scripts 下这 4 个源文件的逐文件接口记录；本目录入口归 agent-creator-scripts-overview
---
# agent-creator-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/init_template.py`**
- 源码对模块职责的说明：Agent Template Initializer — Creates a new agent template package。
- 调用入口 `write_stdout(text)`；声明返回 `None`。
- 调用入口 `get_jiuwenswarm_data_dir()`；声明返回 `Path`。
- 调用入口 `get_agent_workspace_dir()`；声明返回 `Path`。
- 调用入口 `get_agent_templates_local_dir()`；声明返回 `Path`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import os`；`import re`；`import sys`；`from pathlib import Path`。
- 模块级配置或常量名称：`MANIFEST_TEMPLATE`, `README_TEMPLATE`, `PERSONA_TEMPLATE`, `NAME_RE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/init_template.py#L1-L236)。
- **`jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/register_template.py`**
- 源码对模块职责的说明：Register a local agent_template package in marketplace.json.。
- 调用入口 `write_stdout(text)`；声明返回 `None`。
- 调用入口 `get_jiuwenswarm_data_dir()`；声明返回 `Path`。
- 调用入口 `get_agent_workspace_dir()`；声明返回 `Path`。
- 调用入口 `get_agent_templates_local_dir()`；声明返回 `Path`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import os`。
- 模块级配置或常量名称：`NAME_RE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/register_template.py#L1-L273)。
- **`jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py`**
- 源码对模块职责的说明：L2 hot-load worker — runs in a dedicated subprocess.。
- 调用入口 `write_stdout(text)`；声明返回 `None`。
- 调用入口 `main()`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import inspect`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_hot_load_worker.py#L1-L380)。
- **`jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py`**
- 源码对模块职责的说明：Agent Template Validator — 分层校验 agent 模板包。。
- 调用入口 `write_stdout(text)`；声明返回 `None`。
- `Layer` 定义类型边界；方法入口：`__init__`, `error`, `warn`, `note`, `skip`, `tag`。
- 调用入口 `get_jiuwenswarm_data_dir()`；声明返回 `Path`。
- 调用入口 `get_agent_workspace_dir()`；声明返回 `Path`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import ast`；`import json`。
- 模块级配置或常量名称：`HOT_LOAD_WORKER`, `HOT_LOAD_TIMEOUT_SEC`, `LAYER_QUALITY`, `LAYER_STATIC`, `LAYER_HOT_LOAD`, `NAME_RE`, `TODO_MARKER`, `TODO_SCAN_SUFFIXES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/validate_template.py#L1-L991)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/agent-creator-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
