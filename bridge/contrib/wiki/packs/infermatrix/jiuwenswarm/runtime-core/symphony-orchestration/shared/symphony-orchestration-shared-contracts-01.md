---
name: symphony-orchestration-shared-contracts-01
description: shared 源码接口与集成边界 01：symphony/shared 下 __init__.py、llm_payload.py、profiling.py、rich_compat.py、storage.py、tags.py 六个文件的静态接口声明（S3Location、compact_json、StageTimer、normalize_tags 等）
metadata:
  scope: 只收 symphony/shared 六个文件的接口与依赖声明；目录职责与关键文件说明归 jiuwenswarm-symphony-shared
---
# shared 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/symphony/shared/__init__.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .storage import S3Location, create_s3_client, download_s3_object_to_pa`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/shared/__init__.py#L1-L29)。
- **`jiuwenswarm/symphony/shared/llm_payload.py`**
- 源码对模块职责的说明：Shared helpers for compact LLM request payloads.。
- 调用入口 `compact_json(payload)`；声明返回 `str`。
- 调用入口 `prune_empty(value)`；声明返回 `Any`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/shared/llm_payload.py#L1-L32)。
- **`jiuwenswarm/symphony/shared/profiling.py`**
- `StageTimer` 定义类型边界；方法入口：`__init__`, `phase`, `finish`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from contextlib import contextmanager`；`from time import perf_counter`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/shared/profiling.py#L1-L40)。
- **`jiuwenswarm/symphony/shared/rich_compat.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/shared/rich_compat.py#L1-L79)。
- **`jiuwenswarm/symphony/shared/storage.py`**
- `S3Location` 定义类型边界；方法入口：`uri`。
- 调用入口 `is_s3_uri(value)`；声明返回 `bool`。
- 调用入口 `parse_s3_uri(uri, require_key)`；声明返回 `S3Location`。
- 调用入口 `join_s3_uri(base_uri, *parts)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from contextlib import suppress`；`from dataclasses import dataclass`；`from hashlib import sha1`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/shared/storage.py#L1-L298)。
- **`jiuwenswarm/symphony/shared/tags.py`**
- 调用入口 `normalize_tags(*values)`；声明返回 `tuple[str, ...]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections.abc import Iterable, Mapping, Set`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/shared/tags.py#L1-L66)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/shared/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
