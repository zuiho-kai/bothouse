---
name: source-contracts-07
description: common-rails 源码接口与集成边界 07：tool_permission_context.py、trusted_search_urls.py、url_safety.py、files.py、section.py、project_memory_rail.py 等 12 个模块
metadata:
  scope: 只收 common/rails 下 tool_permission_context.py 至 orchestration_rail.py 共 12 个源码文件的静态声明（接口、类型、依赖与源码依据链接）；同目录其余契约页是 common-rails-contracts-01、common-rails-contracts-02、common-rails-contracts-03、common-rails-contracts-04、common-rails-contracts-05、common-rails-contracts-06、source-contracts-08
---
# common-rails 源码接口与集成边界 07

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/rails/permissions/tool_permission_context.py`**
- 源码对模块职责的说明：Tool permission channel context.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import contextvars`。
- 模块级配置或常量名称：`PUBLIC_HTTPS_FETCH_CONTEXT_ATTR`, `TOOL_PERMISSION_CHANNEL_ID`, `TOOL_PERMISSION_REQUEST_ID`, `SKILLS_REBUILD_SILENT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/tool_permission_context.py#L1-L40)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/trusted_search_urls.py`**
- 源码对模块职责的说明：Session-owned trusted search URL ledger and Host producer callback.。
- `SessionTrustedSearchUrls` 定义类型边界；方法入口：`__init__`, `bind_session`, `record_batch`, `contains`, `sources`, `dispose`。
- 调用入口 `bind_trusted_search_producer(ledger, key, tool_name, max_results)`；声明返回 `None`。
- 调用入口 `clear_trusted_search_producer()`；声明返回 `None`。
- 调用入口 `complete_trusted_search_producer(tool_name, success, urls)`；声明返回 `tuple[int, int]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from collections import OrderedDict`；`from collections.abc import Iterable`；`from contextvars import ContextVar`。
- 模块级配置或常量名称：`MAX_TRUSTED_SEARCH_URLS_PER_SESSION`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/trusted_search_urls.py#L1-L236)。
- **`jiuwenswarm/agents/harness/common/rails/permissions/url_safety.py`**
- 源码对模块职责的说明：Shared URL review helpers for read-only network and browser actions.。
- `AbsoluteUriFacts` 定义类型边界。
- `NetworkScopeFacts` 定义类型边界。
- 调用入口 `inspect_network_scope(subject)`；声明返回 `NetworkScopeFacts`。
- 调用入口 `inspect_absolute_uris(value, workspace_root)`；声明返回 `tuple[AbsoluteUriFacts, ...]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import re`；`from collections.abc import Mapping, Sequence`；`from dataclasses import dataclass, field`。
- 模块级配置或常量名称：`URL_PATTERN`, `DOMAIN_PATTERN`, `TRAILING_URL_PUNCTUATION`, `ABSOLUTE_URI_PATTERN`, `UPLOAD_KEYS`, `SAFE_URL_SCHEMES`, `INTERNAL_HOST_SUFFIXES`, `METADATA_HOSTS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/url_safety.py#L1-L541)。
- **`jiuwenswarm/agents/harness/common/rails/project_memory/files.py`**
- 源码对模块职责的说明：Project memory file discovery + merge.。
- `LoadedMemoryFile` 定义类型边界。
- `GitWorktreeInfo` 定义类型边界。
- 调用入口 `clear_project_memory_cache(workspace)`；声明返回 `None`。
- 调用入口 `find_project_root(cwd)`；声明返回 `Optional[Path]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import functools`；`import glob as _glob`；`import os`。
- 模块级配置或常量名称：`PROJECT_ROOT_MARKERS`, `PROJECT_MEMORY_FILES`, `LOCAL_MEMORY_FILES`, `PROJECT_MEMORY_GLOBS`, `USER_MEMORY_FILES`, `USER_MEMORY_GLOBS`, `MANAGED_MEMORY_FILES`, `MANAGED_MEMORY_GLOBS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/project_memory/files.py#L1-L962)。
- **`jiuwenswarm/agents/harness/common/rails/project_memory/section.py`**
- 源码对模块职责的说明：PromptSection factory for project memory.。
- 调用入口 `build_project_memory_section(content, language, priority)`；声明返回 `Optional[PromptSection]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Optional`；`from openjiuwen.harness.prompts import PromptSection`；`from jiuwenswarm.agents.harness.common.prompt.priority_registry import Syst`。
- 模块级配置或常量名称：`SECTION_NAME`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/project_memory/section.py#L1-L58)。
- **`jiuwenswarm/agents/harness/common/rails/project_memory_rail.py`**
- 源码对模块职责的说明：ProjectMemoryRail -- jiuwenswarm product-side rail.。
- `ProjectMemoryRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`, `set_language`, `set_workspace_path`, `get_language`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`from typing import TYPE_CHECKING`；`from openjiuwen.core.single_agent.rail.base import AgentCallbackContext`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/project_memory_rail.py#L1-L227)。
- **`jiuwenswarm/agents/harness/common/rails/response_prompt_rail.py`**
- 源码对模块职责的说明：Inject the response/message-format section before each model call.。
- `ResponsePromptRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`, `set_channel`, `before_invoke`, `before_model_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from collections.abc import Mapping`；`from openjiuwen.core.single_agent.rail.base import AgentCallbackContext`。
- 模块级配置或常量名称：`A2UI_BROWSER_WORKFLOW_CONTEXT_KEY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/response_prompt_rail.py#L1-L243)。
- **`jiuwenswarm/agents/harness/common/rails/runtime_prompt_rail.py`**
- 源码对模块职责的说明：RuntimePromptRail — Assemble stable and dynamic runtime prompt state.。
- `RuntimePromptRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`, `set_language`, `set_channel`, `set_trusted_dirs`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`import shutil`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/runtime_prompt_rail.py#L1-L795)。
- **`jiuwenswarm/agents/harness/common/rails/skill_retrieval_prompt_rail.py`**
- 源码对模块职责的说明：Prompt boundary for Symphony-managed runtime Skill discovery.。
- `SkillRetrievalPromptRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`, `before_invoke`, `before_model_call`, `after_model_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any`；`from openjiuwen.core.single_agent.rail.base import AgentCallbackContext`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/skill_retrieval_prompt_rail.py#L1-L581)。
- **`jiuwenswarm/agents/harness/common/rails/stream_event_rail.py`**
- 源码对模块职责的说明：JiuSwarmStreamEventRail — Stream event emission, pause checks, context fix.。
- `JiuSwarmStreamEventRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `callback_priority`, `init`, `pause`, `resume`, `abort`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import copy`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L1-L1840)。
- **`jiuwenswarm/agents/harness/common/rails/symphony/__init__.py`**
- 源码对模块职责的说明：Symphony-specific agent rails and stream lifecycle helpers.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.agents.harness.common.rails.symphony.orchestration_rail im`；`from jiuwenswarm.agents.harness.common.rails.symphony.tool_stream_events im`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/symphony/__init__.py#L1-L10)。
- **`jiuwenswarm/agents/harness/common/rails/symphony/orchestration_rail.py`**
- 源码对模块职责的说明：Prompt and candidate lifecycle rail for Symphony orchestration.。
- `SymphonyOrchestrationRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`, `before_invoke`, `after_invoke`, `before_model_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import re`；`import threading`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/symphony/orchestration_rail.py#L1-L1140)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-rails/source-contracts-07.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
