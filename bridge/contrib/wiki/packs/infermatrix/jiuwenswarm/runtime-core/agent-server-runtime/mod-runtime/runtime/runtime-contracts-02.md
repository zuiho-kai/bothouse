---
name: runtime-contracts-02
description: runtime 源码接口 02：team_entity_store、tenant_agent_pool、tokenizer_service 的声明、方法入口与导入依赖
metadata:
  scope: 只收 jiuwenswarm/server/runtime 后三个文件的接口记录；前十三个文件归 runtime-contracts-01，目录入口归 runtime-overview
---
# runtime 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/team_entity_store.py`**
- 源码对模块职责的说明：Persistent per-team entity metadata stored in the team workspace.。
- `TeamEntityStoreError` 继承 `ValueError`；方法入口：`__init__`。
- `TeamEntity` 定义类型边界；方法入口：`from_dict`, `to_dict`。
- `TeamEntityStore` 定义类型边界；方法入口：`__init__`, `entity_path`, `exists`, `get`, `write`, `ensure`。
- 调用入口 `get_team_entity_store()`；声明返回 `TeamEntityStore`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import shutil`；`import threading`；`import time`。
- 模块级配置或常量名称：`TEAM_ENTITY_META_DIR`, `TEAM_ENTITY_FILE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/team_entity_store.py#L1-L282)。
- **`jiuwenswarm/server/runtime/tenant_agent_pool.py`**
- `TenantAgentPool` 定义类型边界；方法入口：`__init__`, `get_instance`, `reset_instance`, `process_message`, `process_message_stream`, `cleanup`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any, ClassVar`；`from jiuwenswarm.common.schema.agent import AgentRequest, AgentResponse`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/tenant_agent_pool.py#L1-L89)。
- **`jiuwenswarm/server/runtime/tokenizer_service.py`**
- 源码对模块职责的说明：AgentServer-side tokenizer cache warm-up service.。
- `TokenizerProfile` 定义类型边界。
- `TokenizerWarmupSettings` 定义类型边界。
- 调用入口 `resolve_tokenizer_cache_dir(config)`；声明返回 `Path`。
- 调用入口 `tokenizer_warmup_settings(config)`；声明返回 `TokenizerWarmupSettings`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import hashlib`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/tokenizer_service.py#L1-L1435)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
