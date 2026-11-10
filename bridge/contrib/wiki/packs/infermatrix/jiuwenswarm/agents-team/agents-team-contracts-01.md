---
name: agents-team-contracts-01
description: agents-team 源码接口清单 01：agent_observability.py 与 observability_runtime.py 的模块职责、调用入口与导入依赖
metadata:
  scope: 只收这两个源码文件的静态声明；Code harness 提示词、审批与观测开关的行为说明归 knowledge-agents-team
---
# agents-team 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/agent_observability.py`**
- 源码对模块职责的说明：Config-gated lifecycle for single-agent / coding-agent observability.。
- 调用入口 `sync_agent_observability(force)`；声明返回 `None`。
- 调用入口 `shutdown_agent_observability()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import threading`；`from openjiuwen.harness.observability import acquire_observability, release`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/agent_observability.py#L1-L191)。
- **`jiuwenswarm/agents/harness/observability_runtime.py`**
- 源码对模块职责的说明：Mapping from JiuwenSwarm settings to the SDK observability config.。
- 调用入口 `build_observability_config(config, service_name, default_exporter, default_endpoint, traces_dir)`；声明返回 `Any`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from collections.abc import Mapping`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/observability_runtime.py#L1-L56)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
