---
name: symphony-orchestration-contracts-01
description: symphony-orchestration 源码接口与集成边界 01：jiuwenswarm/symphony/experience.py（PublishedCapabilitySnapshotProvider）与 llm.py（LLMConfig、register_request_model、resolve_request_llm_config、bind_request_llm_config）的静态声明
metadata:
  scope: 只收 experience.py 与 llm.py 两个模块的接口与依赖声明；evolution、shared、skill_retrieval 子目录的声明分别归 evolution-contracts-01、symphony-orchestration-shared-contracts-01、skill-retrieval-contracts-01
---
# symphony-orchestration 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/symphony/experience.py`**
- 源码对模块职责的说明：JiuwenSwarm adapters for Symphony execution evidence and packages.。
- `PublishedCapabilitySnapshotProvider` 定义类型边界；方法入口：`__init__`, `snapshot_capabilities`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from copy import deepcopy`；`from dataclasses import replace`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/experience.py#L1-L329)。
- **`jiuwenswarm/symphony/llm.py`**
- 源码对模块职责的说明：LLM helpers backed by JiuwenSwarm's configured model stack.。
- `LLMConfig` 定义类型边界；方法入口：`from_default_model`, `from_model_entry`, `from_model`, `backend`, `base_url`, `model_client_kwargs`。
- 调用入口 `register_request_model(model)`；声明返回 `str`。
- 调用入口 `resolve_request_llm_config(reference)`；声明返回 `LLMConfig`。
- 调用入口 `bind_request_llm_config(reference)`；声明返回 `Token`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import json`；`from collections import defaultdict`。
- 模块级配置或常量名称：`LLM_IDENTITY_SCHEMA_VERSION`, `SYMPHONY_LLM_CONFIG_REF_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/llm.py#L1-L731)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
