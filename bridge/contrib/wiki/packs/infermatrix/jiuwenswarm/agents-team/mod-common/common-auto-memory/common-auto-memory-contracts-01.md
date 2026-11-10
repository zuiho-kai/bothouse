---
name: common-auto-memory-contracts-01
description: common-auto-memory 源码接口与集成边界 01：__init__.py、extract_memories.py、prompts.py、tool_restriction_rail.py
metadata:
  scope: 只收 common/auto_memory 下 __init__.py 至 tool_restriction_rail.py 共 4 个源码文件的静态声明（接口、类型、依赖与源码依据链接）
---
# common-auto-memory 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/auto_memory/__init__.py`**
- 源码对模块职责的说明：Auto Memory module for jiuwenswarm.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.agents.harness.common.auto_memory.extraction_runner import`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/__init__.py#L1-L23)。
- **`jiuwenswarm/agents/harness/common/auto_memory/extract_memories.py`**
- 源码对模块职责的说明：Extract memories from conversation after it ends.。
- 调用入口 `scan_memory_files(memory_dir)`；声明返回 `list[dict[str, Any]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import re`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extract_memories.py#L1-L137)。
- **`jiuwenswarm/agents/harness/common/auto_memory/prompts.py`**
- 源码对模块职责的说明：Prompt templates for Auto Memory extraction.。
- 调用入口 `build_extract_memories_prompt(new_messages_count, existing_memories, language)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/prompts.py#L1-L197)。
- **`jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py`**
- 源码对模块职责的说明：AutoMemoryToolRestrictionRail - restrict tool calls for extract_memories subagent.。
- `AutoMemoryToolRestrictionRail` 继承 `AgentRail`；方法入口：`__init__`, `before_tool_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from pathlib import Path`；`from typing import Any, Dict`。
- 模块级配置或常量名称：`UNRESTRICTED_READ_TOOLS`, `READ_ONLY_BASH_COMMANDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py#L1-L353)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-auto-memory/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
