---
name: agent-client-contracts-01
description: agent-client 源码接口与集成边界 01：extensions/agent_client 的 __init__.py（导入 register_extensions）与 extension.py（YuanrongAgentServerClientExtension：__init__、initialize、get_client；register_extensions）声明
metadata:
  scope: 只收 agent_client 目录两个文件的静态声明；入口说明归 agent-client-overview，基类 AgentServerClientExtension 的声明归 sdk-contracts-01
---
# agent-client 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/extensions/agent_client/__init__.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .extension import register_extensions`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agent_client/__init__.py#L1-L3)。
- **`jiuwenswarm/extensions/agent_client/extension.py`**
- 源码对模块职责的说明：AgentServerClient 扩展.。
- `YuanrongAgentServerClientExtension` 继承 `AgentServerClientExtension`；方法入口：`__init__`, `initialize`, `get_client`。
- 异步入口 `register_extensions(registry)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.common.config import get_config`；`from jiuwenswarm.extensions.sdk import AgentServerClientExtension`；`from jiuwenswarm.extensions.yuanrong_frontend_client import YuanrongFronten`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agent_client/extension.py#L1-L60)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/agent-client/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
