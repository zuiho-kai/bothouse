---
name: common-memory-contracts-01
description: common-memory 源码接口与集成边界 01：__init__.py、config.py、__init__.py、sweeper.py、embeddings.py、forbidden.py 等 8 个模块
metadata:
  scope: 只收 common/memory 下 __init__.py 至 types.py 共 8 个源码文件的静态声明（接口、类型、依赖与源码依据链接）
---
# common-memory 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/memory/__init__.py`**
- 源码对模块职责的说明：Memory system for JiuWenSwarm.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .types import MemorySearchResult, MemoryFileEntry, MemoryChunk, Memory`；`from .manager import MemoryIndexManager, get_memory_manager, clear_memory_m`；`from .config import MemorySettings, create_memory_settings, is_memory_enabl`；
  - `from .embeddings import EmbeddingProvider, create_embedding_provider`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/__init__.py#L1-L78)。
- **`jiuwenswarm/agents/harness/common/memory/config.py`**
- 源码对模块职责的说明：Memory configuration for JiuWenSwarm.。
- 调用入口 `clear_config_cache()`；声明返回 `None`。
- 调用入口 `get_embed_config()`；声明返回 `Dict[str, str]`。
- `MemorySettings` 定义类型边界。
- 调用入口 `create_memory_settings(workspace_dir, **overrides)`；声明返回 `MemorySettings`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import os`；`import re`；`from typing import Any, Optional, Dict, List`。
- 模块级配置或常量名称：`DEFAULT_CONFIG_PATH`, `DEFAULT_WORKSPACE_DIR`, `EMBED_API_KEY`, `EMBED_BASE_URL`, `EMBED_MODEL`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/config.py#L1-L339)。
- **`jiuwenswarm/agents/harness/common/memory/dreaming/__init__.py`**
- 源码对模块职责的说明：Public API of Dreaming Memory Integration Module。
- 调用入口 `get_dreaming_orchestrator(mode)`；声明返回 `DreamingOrchestrator / None`。
- 异步入口 `start_dreaming(sessions_dir, output_dir, mode, busy_checker)`；声明返回 `DreamingOrchestrator / None`。
- 异步入口 `stop_dreaming(mode)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Callable`；`from openjiuwen.core.memory.dreaming import DreamingOrchestrator`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/dreaming/__init__.py#L1-L86)。
- **`jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py`**
- 源码对模块职责的说明：Dreaming Sweeper: Scan + Compression + LLM Extraction + Promotion (Unified Pipeline)。
- `DreamingConfig` 定义类型边界；方法入口：`load`。
- `Sweeper` 定义类型边界；方法入口：`__init__`, `init`, `run_sweep`, `scan_new_sessions`, `load_existing_summary`, `promote_agent`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import hashlib`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py#L1-L813)。
- **`jiuwenswarm/agents/harness/common/memory/embeddings.py`**
- 源码对模块职责的说明：Embedding providers for memory system.。
- `EmbeddingProvider` 继承 `ABC`；方法入口：`embed_query`, `embed_documents`。
- `OpenAICompatibleEmbeddingProvider` 继承 `EmbeddingProvider`；方法入口：`__init__`, `embed_query`, `embed_documents`。
- `MockEmbeddingProvider` 继承 `EmbeddingProvider`；方法入口：`embed_query`, `embed_documents`。
- 异步入口 `create_embedding_provider(provider, model, fallback)`；声明返回 `EmbeddingProvider`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import os`；`from abc import ABC, abstractmethod`；`from typing import List, Optional`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/embeddings.py#L1-L175)。
- **`jiuwenswarm/agents/harness/common/memory/forbidden.py`**
- 调用入口 `contains_forbidden_memory_content(text)`；声明返回 `bool`。
- 调用入口 `get_forbidden_memory_prompt(language)`；声明返回 `str`。
- 调用入口 `get_disabled_memory_filter_prompt(language)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import re`；`from typing import Any, Dict, Iterable`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/forbidden.py#L1-L221)。
- **`jiuwenswarm/agents/harness/common/memory/internal.py`**
- 源码对模块职责的说明：Internal utilities for memory system.。
- 调用入口 `estimate_tokens(text)`；声明返回 `int`。
- 调用入口 `ensure_dir(path)`；声明返回 `None`。
- 调用入口 `list_memory_files(workspace_dir, extra_paths)`；声明返回 `List[str]`。
- 异步入口 `build_file_entry(abs_path, workspace_dir)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import os`；`import re`；`import hashlib`；`import math`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/internal.py#L1-L215)。
- **`jiuwenswarm/agents/harness/common/memory/types.py`**
- 源码对模块职责的说明：Memory system type definitions.。
- `MemorySearchResult` 定义类型边界。
- `MemoryProviderStatus` 定义类型边界。
- `MemorySyncProgressUpdate` 定义类型边界。
- `FileEntry` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from typing import Optional, Literal`；`from dataclasses import dataclass`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/types.py#L1-L79)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-memory/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
