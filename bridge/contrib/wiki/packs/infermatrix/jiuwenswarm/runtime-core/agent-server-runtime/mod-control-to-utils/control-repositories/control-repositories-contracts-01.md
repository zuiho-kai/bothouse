---
name: control-repositories-contracts-01
description: control-repositories 源码接口与集成边界 01：project_repository.py 的 handle_project_request 与 session_repository.py 的 handle_list、handle_get_metadata、handle_pin、handle_color_set 等入口声明
metadata:
  scope: 只收 control/repositories 两个模块的静态声明，不证明运行行为；入口说明归 control-repositories-overview，上层 control 模块归 control-contracts-01
---
# control-repositories 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/control/repositories/project_repository.py`**
- 源码对模块职责的说明：Project disk store used by Front Control.。
- 异步入口 `handle_project_request(request)`；声明返回 `AgentResponse`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from jiuwenswarm.common.schema.agent import AgentRequest, AgentResponse`；`from jiuwenswarm.common.schema.message import ReqMethod`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/repositories/project_repository.py#L1-L84)。
- **`jiuwenswarm/server/control/repositories/session_repository.py`**
- 源码对模块职责的说明：Session metadata store used by Front Control.。
- 异步入口 `handle_list(request)`；声明返回 `AgentResponse`。
- 异步入口 `handle_get_metadata(request)`；声明返回 `AgentResponse`。
- 异步入口 `handle_pin(request)`；声明返回 `AgentResponse`。
- 异步入口 `handle_color_set(request)`；声明返回 `AgentResponse`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from typing import Final`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/repositories/session_repository.py#L1-L219)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/control-repositories/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
