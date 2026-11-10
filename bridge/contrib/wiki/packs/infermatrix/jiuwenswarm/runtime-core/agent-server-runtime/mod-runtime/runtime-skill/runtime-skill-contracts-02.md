---
name: runtime-skill-contracts-02
description: runtime-skill 源码接口与集成边界 02：skilldev/stages 下 evaluate、generate、improve、init、package、plan、test_design、test_run、validate 九个阶段文件，加 state_utils、store、workspace、skillpack、skills_multipart_http 共十四个文件的静态声明
metadata:
  scope: 只收 skill 目录最后十四个文件的静态声明，不证明运行行为；__init__ 到 stages/desc_optimize_stage 的十四个文件归 runtime-skill-contracts-01，入口说明归 runtime-skill-overview
---
# runtime-skill 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/evaluate_stage.py`**
- 源码对模块职责的说明：EVALUATE 阶段处理器.。
- `EvaluateStageHandler` 继承 `StageHandler`；方法入口：`execute`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import math`。
- 模块级配置或常量名称：`GRADER_SYSTEM_PROMPT`, `ANALYST_SYSTEM_PROMPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/evaluate_stage.py#L1-L327)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/generate_stage.py`**
- 源码对模块职责的说明：GENERATE 阶段处理器.。
- `GenerateStageHandler` 继承 `StageHandler`；方法入口：`execute`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from pathlib import Path`；`from jiuwenswarm.server.runtime.skill.skilldev.context import SkillDevConte`。
- 模块级配置或常量名称：`GENERATE_SYSTEM_PROMPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/generate_stage.py#L1-L208)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/improve_stage.py`**
- 源码对模块职责的说明：IMPROVE 阶段处理器.。
- `ImproveStageHandler` 继承 `StageHandler`；方法入口：`execute`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from jiuwenswarm.server.runtime.skill.skilldev.context import SkillDevConte`；`from jiuwenswarm.server.runtime.skill.skilldev.schema import SkillDevEventT`。
- 模块级配置或常量名称：`IMPROVE_SYSTEM_PROMPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/improve_stage.py#L1-L138)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/init_stage.py`**
- 源码对模块职责的说明：INIT 阶段处理器.。
- `InitStageHandler` 继承 `StageHandler`；方法入口：`execute`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import base64`；`import logging`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/init_stage.py#L1-L128)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/package_stage.py`**
- 源码对模块职责的说明：PACKAGE 阶段处理器.。
- `PackageStageHandler` 继承 `StageHandler`；方法入口：`execute`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import zipfile`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/package_stage.py#L1-L100)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/plan_stage.py`**
- 源码对模块职责的说明：PLAN 阶段处理器.。
- `PlanStageHandler` 继承 `StageHandler`；方法入口：`execute`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from jiuwenswarm.server.runtime.skill.skilldev.context import SkillDevConte`。
- 模块级配置或常量名称：`PLAN_SYSTEM_PROMPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/plan_stage.py#L1-L167)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/test_design_stage.py`**
- 源码对模块职责的说明：TEST_DESIGN 阶段处理器.。
- `TestDesignStageHandler` 继承 `StageHandler`；方法入口：`execute`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from jiuwenswarm.server.runtime.skill.skilldev.context import SkillDevConte`。
- 模块级配置或常量名称：`TEST_DESIGN_SYSTEM_PROMPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/test_design_stage.py#L1-L140)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/test_run_stage.py`**
- 源码对模块职责的说明：TEST_RUN 阶段处理器.。
- `TestRunStageHandler` 继承 `StageHandler`；方法入口：`execute`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/test_run_stage.py#L1-L143)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/validate_stage.py`**
- 源码对模块职责的说明：VALIDATE 阶段处理器.。
- `ValidateStageHandler` 继承 `StageHandler`；方法入口：`execute`。
- 调用入口 `validate_skill_md(skill_md_path)`；声明返回 `tuple[bool, str]`。
- 调用入口 `parse_skill_frontmatter(skill_md_path)`；声明返回 `tuple[str, str, str]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import re`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/validate_stage.py#L1-L153)。
- **`jiuwenswarm/server/runtime/skill/skilldev/state_utils.py`**
- 源码对模块职责的说明：Skill 状态工具函数 — 纯函数，无 SkillManager 依赖.。
- 调用入口 `get_state_file()`；声明返回 `Path`。
- 调用入口 `normalize_skill_configs(raw_configs)`；声明返回 `dict[str, dict[str, bool]]`。
- 调用入口 `get_registered_skill_names(state)`；声明返回 `set[str]`。
- 调用入口 `normalize_local_skills(raw_local_skills, existing_local_skill_names)`；声明返回 `list[dict[str, Any]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/state_utils.py#L1-L180)。
- **`jiuwenswarm/server/runtime/skill/skilldev/store.py`**
- 源码对模块职责的说明：StateStore — SkillDev 任务状态的持久化层.。
- `StateStore` 定义类型边界；方法入口：`__init__`, `save_state`, `load_state`, `load_state_sync`, `list_tasks`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/store.py#L1-L84)。
- **`jiuwenswarm/server/runtime/skill/skilldev/workspace.py`**
- 源码对模块职责的说明：WorkspaceProvider — SkillDev 任务工作区管理.。
- `WorkspaceProvider` 定义类型边界；方法入口：`__init__`, `get_local_path`, `ensure_local`, `sync_to_remote`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/workspace.py#L1-L65)。
- **`jiuwenswarm/server/runtime/skill/skillpack.py`**
- 源码对模块职责的说明：SDD-0010 SkillPack parsing, validation, and availability projection.。
- `SkillPackValidationError` 继承 `ValueError`。
- `SkillPackOperationUnsupportedError` 继承 `ValueError`。
- `SkillPackDefinition` 定义类型边界。
- `SkillPackStatus` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import re`；`from dataclasses import dataclass`。
- 模块级配置或常量名称：`SKILLPACK_KIND`, `SKILLPACK_SKILL_TYPE`, `MEMBER_BACKUP_DIRNAME`, `CONTAINER_SKILLS_DIRNAME`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skillpack.py#L1-L864)。
- **`jiuwenswarm/server/runtime/skill/skills_multipart_http.py`**
- 源码对模块职责的说明：''/file-api/skills/*'' multipart 上传处理.。
- 调用入口 `skill_http_error_status(code)`；声明返回 `int`。
- 调用入口 `skill_http_error_body(code, message)`；声明返回 `dict[str, str]`。
- 调用入口 `parse_multipart_form(content_type, body)`；声明返回 `dict[str, Any]`。
- 调用入口 `handle_skills_upload_temp_http(content_type, body)`；声明返回 `tuple[int, dict[str, Any]]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import email.parser`；`import email.policy`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skills_multipart_http.py#L1-L405)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-skill/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
