---
name: sdk-contracts-01
description: sdk 源码接口与集成边界 01：extensions/sdk 的 __init__.py（懒加载导出）、agent_server_client（AgentServerClientExtension）、crypto_utility（CryptoUtility）、third_agent（ThirdAgentExtension）声明
metadata:
  scope: 只收 extensions/sdk 目录四个文件的静态声明；入口说明归 sdk-overview，扩展实现类归 agent-client-contracts-01 等各模块契约页
---
# sdk 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/extensions/sdk/__init__.py`**
- 源码对模块职责的说明：Extension SDK exports; transport-specific contracts are lazy imports.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from importlib import import_module`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/sdk/__init__.py#L1-L61)。
- **`jiuwenswarm/extensions/sdk/agent_server_client.py`**
- `AgentServerClientExtension` 继承 `BaseExtension`；方法入口：`get_client`, `shutdown`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from abc import abstractmethod`；`from jiuwenswarm.common.client.agent_client import AgentServerClient`；`from jiuwenswarm.extensions.sdk.base import BaseExtension`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/sdk/agent_server_client.py#L1-L17)。
- **`jiuwenswarm/extensions/sdk/crypto_utility.py`**
- `CryptoUtility` 继承 `BaseExtension`；方法入口：`get_crypto`, `shutdown`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from abc import abstractmethod`；`from jiuwenswarm.extensions.sdk.base import BaseExtension`；`from jiuwenswarm.common.security.base_crypto import CryptoProvider`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/sdk/crypto_utility.py#L1-L17)。
- **`jiuwenswarm/extensions/sdk/third_agent.py`**
- `ThirdAgentExtension` 继承 `BaseExtension`；方法入口：`get_third_agent`, `shutdown`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from abc import abstractmethod`；`from jiuwenswarm.extensions.sdk.base import BaseExtension`；`from jiuwenswarm.common.client.third_agent import ThirdAgent`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/sdk/third_agent.py#L1-L19)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/sdk/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
