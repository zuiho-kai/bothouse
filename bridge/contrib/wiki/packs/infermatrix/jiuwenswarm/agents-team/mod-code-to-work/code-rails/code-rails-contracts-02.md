---
name: code-rails-contracts-02
description: code-rails 源码接口与集成边界 02：heartbeat/store、heartbeat/tools、heartbeat_rail，以及 sdd 子包（common/rail_state_machine、design_rail 的 config_loader、rail 与 aet-req-analysis、aet-req-design 的 assemble 脚本）声明
metadata:
  scope: 只收 heartbeat 余下文件与 sdd 子包的静态声明；更早的文件归 code-rails-contracts-01-1 和 code-rails-contracts-01-2
---
# code-rails 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/code/rails/heartbeat/store.py`**
- 源码对模块职责的说明：HeartbeatJobStore — 读写 heartbeat_jobs.json.。
- `HeartbeatStoreDataError` 继承 `ValueError`。
- `HeartbeatJobStore` 定义类型边界；方法入口：`__init__`, `path`, `list_jobs`, `get_job`, `claim_run`, `replace_claimed_run`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/store.py#L1-L1203)。
- **`jiuwenswarm/agents/harness/code/rails/heartbeat/tools.py`**
- `HeartbeatJobService` 继承 `Protocol`；方法入口：`handle_operation`。
- `HeartbeatRuntimeBridge` 定义类型边界；方法入口：`__init__`, `set_service`, `build_tools`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any, Protocol`；`from openjiuwen.core.foundation.tool import LocalFunction, Tool, ToolCard`；`from jiuwenswarm.agents.harness.code.rails.heartbeat.models import DEFAULT_`。
- 模块级配置或常量名称：`HEARTBEAT_TOOL_NAMES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/tools.py#L1-L312)。
- **`jiuwenswarm/agents/harness/code/rails/heartbeat_rail.py`**
- 源码对模块职责的说明：Agent Heartbeat Rail shared by single-agent and Team profiles.。
- `HeartbeatRail` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any`；`from openjiuwen.harness.rails.base import DeepAgentRail`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat_rail.py#L1-L60)。
- **`jiuwenswarm/agents/harness/code/rails/sdd/__init__.py`**
- 源码对模块职责的说明：SDD-family state-machine rails — shared base + independent rails.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.agents.harness.code.rails.sdd.common.rail_state_machine im`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/__init__.py#L1-L24)。
- **`jiuwenswarm/agents/harness/code/rails/sdd/common/__init__.py`**
- 源码对模块职责的说明：Shared infrastructure for SDD-family rails.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.agents.harness.code.rails.sdd.common.rail_state_machine im`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/common/__init__.py#L1-L15)。
- **`jiuwenswarm/agents/harness/code/rails/sdd/common/rail_state_machine.py`**
- 源码对模块职责的说明：RailStateMachineBase — shared base for state-machine-driven rails.。
- `RailStateMachineBase` 继承 `DeepAgentRail`；方法入口：`__init__`, `init`, `uninit`, `before_model_call`, `after_tool_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from pathlib import Path`；`from typing import Any, Optional`；`from openjiuwen.core.foundation.tool import LocalFunction, ToolCard`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/common/rail_state_machine.py#L1-L680)。
- **`jiuwenswarm/agents/harness/code/rails/sdd/design_rail/__init__.py`**
- 源码对模块职责的说明：DesignRail package — SDD (Spec-Driven Development) state machine for Code mode.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.agents.harness.code.rails.sdd.design_rail.rail import Desi`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/__init__.py#L1-L20)。
- **`jiuwenswarm/agents/harness/code/rails/sdd/design_rail/config_loader.py`**
- 源码对模块职责的说明：config_loader — YAML load + one-shot validation for design_rail/config.yaml.。
- `ConfigLoadError` 继承 `Exception`。
- `ValidationResult` 定义类型边界。
- 调用入口 `load(path)`；声明返回 `dict`。
- 调用入口 `validate(cfg, rail_pkg_dir)`；声明返回 `ValidationResult`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass, field`；`from pathlib import Path`；`from typing import List, Optional`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/config_loader.py#L1-L158)。
- **`jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py`**
- 源码对模块职责的说明：DesignRail — SDD (Spec-Driven Development) state machine for Code mode.。
- `DesignRail` 继承 `RailStateMachineBase`；方法入口：`__init__`, `after_tool_call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from pathlib import Path`；`from typing import Optional`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py#L1-L211)。
- **`jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-analysis/scripts/assemble-checklist.mjs`**
- 源码声明的类型、组件或调用边界：`__dirname`, `skillTemplatesDir`, `projectAetDir`, `userAetDir`, `resolveFile`, `searchPaths`, `filePath`, `parseArgs`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { readFileSync, existsSync } from 'fs';`；`import { join, dirname } from 'path';`；`import { fileURLToPath } from 'url';`；`import { homedir } from 'os';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-analysis/scripts/assemble-checklist.mjs#L1-L230)。
- **`jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-analysis/scripts/assemble-template.mjs`**
- 源码声明的类型、组件或调用边界：`__dirname`, `skillTemplatesDir`, `projectAetDir`, `userAetDir`, `resolveFile`, `searchPaths`, `filePath`, `getCurrentTime`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { readFileSync, existsSync } from 'fs';`；`import { join, dirname } from 'path';`；`import { fileURLToPath } from 'url';`；`import { homedir } from 'os';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-analysis/scripts/assemble-template.mjs#L1-L392)。
- **`jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-design/scripts/assemble-checklist.mjs`**
- 源码声明的类型、组件或调用边界：`__dirname`, `skillTemplatesDir`, `projectAetDir`, `userAetDir`, `resolveFile`, `searchPaths`, `filePath`, `parseArgs`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { readFileSync, existsSync } from 'fs';`；`import { join, dirname } from 'path';`；`import { fileURLToPath } from 'url';`；`import { homedir } from 'os';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-design/scripts/assemble-checklist.mjs#L1-L230)。
- **`jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-design/scripts/assemble-template.mjs`**
- 源码声明的类型、组件或调用边界：`__dirname`, `skillTemplatesDir`, `projectAetDir`, `userAetDir`, `resolveFile`, `searchPaths`, `filePath`, `getCurrentTime`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { readFileSync, existsSync } from 'fs';`；`import { join, dirname } from 'path';`；`import { fileURLToPath } from 'url';`；`import { homedir } from 'os';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-design/scripts/assemble-template.mjs#L1-L392)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/code-rails/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
