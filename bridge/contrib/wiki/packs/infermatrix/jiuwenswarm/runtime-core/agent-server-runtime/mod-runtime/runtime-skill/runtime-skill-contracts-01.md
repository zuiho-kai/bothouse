---
name: runtime-skill-contracts-01
description: runtime-skill 源码接口与集成边界 01：skill 目录 __init__、archive_store、skill_content_images、skill_files、skill_type，以及 skilldev 下 __init__、context、deps、pipeline、schema、service 与 stages 的 __init__、base、desc_optimize_stage 共十四个文件的静态声明
metadata:
  scope: 只收 skill 目录按路径序前十四个文件的静态声明，不证明运行行为；stages/evaluate_stage 起的其余文件归 runtime-skill-contracts-02，入口说明归 runtime-skill-overview
---
# runtime-skill 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/skill/__init__.py`**
- 源码对模块职责的说明：Skill 运行时模块 — 对外暴露公共工具函数.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.server.runtime.skill.skilldev import filter_visible_skill_`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/__init__.py#L1-L29)。
- **`jiuwenswarm/server/runtime/skill/archive_store.py`**
- 源码对模块职责的说明：Skill 本地产品版本仓储（''.archive/versions''）.。
- `SkillArchiveError` 继承 `Exception`；方法入口：`__init__`。
- 调用入口 `empty_versions_index()`；声明返回 `dict[str, Any]`。
- 调用入口 `archive_root(skill_dir)`；声明返回 `Path`。
- 调用入口 `versions_index_path(skill_dir)`；声明返回 `Path`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`from pathlib import Path, PurePosixPath`。
- 模块级配置或常量名称：`ARCHIVE_DIRNAME`, `VERSIONS_DIRNAME`, `INDEX_FILENAME`, `CONTENT_DIRNAME`, `SCHEMA_VERSION`, `ERROR_VERSION_NOT_FOUND`, `ERROR_VERSION_CONTENT_INVALID`, `ERROR_INDEX_CORRUPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/archive_store.py#L1-L376)。
- **`jiuwenswarm/server/runtime/skill/skill_content_images.py`**
- 源码对模块职责的说明：Skill 正文 Markdown 本地图片改写与受控预览解析.。
- 调用入口 `is_allowed_skill_content_image(path, mime_type)`；声明返回 `bool`。
- 调用入口 `build_skill_content_image_url(token, session_id)`；声明返回 `str`。
- 调用入口 `resolve_skill_content_root(name, version, skills_dir)`；声明返回 `Path`。
- 调用入口 `resolve_skill_content_image_file(name, version, relative_path, skills_dir)`；声明返回 `tuple[Path, str]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import mimetypes`；`import re`。
- 模块级配置或常量名称：`ALLOWED_SKILL_CONTENT_IMAGE_MIMES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_content_images.py#L1-L294)。
- **`jiuwenswarm/server/runtime/skill/skill_files.py`**
- 源码对模块职责的说明：Skill 工作副本文件预览（skills.files.*）.。
- `SkillFilesError` 继承 `Exception`；方法入口：`__init__`。
- 调用入口 `guess_mime_type(path)`；声明返回 `str`。
- 调用入口 `list_skill_workspace_files(skill_root)`；声明返回 `list[dict[str, Any]]`。
- 调用入口 `resolve_skill_relative_file(skill_root, relative_path)`；声明返回 `tuple[Path, str]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import mimetypes`；`from pathlib import Path, PurePosixPath`；`from typing import Any`。
- 模块级配置或常量名称：`ERROR_UNSAFE_PATH`, `ERROR_NOT_FOUND`, `ERROR_FILE_TOO_LARGE`, `DEFAULT_TEXT_PREVIEW_MAX_BYTES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_files.py#L1-L234)。
- **`jiuwenswarm/server/runtime/skill/skill_type.py`**
- 源码对模块职责的说明：根据 Skill frontmatter / 资源识别 skill_type.。
- 调用入口 `detect_skill_type(skill_dir)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import re`；`from pathlib import Path`；`import yaml`。
- 模块级配置或常量名称：`SKILL_TYPE_SKILL`, `SKILL_TYPE_SKILLPACK`, `SKILL_TYPE_SWARM`, `SKILL_TYPE_MULTIMODAL`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skill_type.py#L1-L122)。
- **`jiuwenswarm/server/runtime/skill/skilldev/__init__.py`**
- 源码对模块职责的说明：SkillDev — Skill 开发模式模块.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.server.runtime.skill.skilldev.state_utils import filter_vi`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/__init__.py#L1-L46)。
- **`jiuwenswarm/server/runtime/skill/skilldev/context.py`**
- 源码对模块职责的说明：SkillDevContext — 每个阶段的执行上下文.。
- `SkillDevContext` 定义类型边界；方法入口：`__init__`, `emit`, `create_stage_agent`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/context.py#L1-L114)。
- **`jiuwenswarm/server/runtime/skill/skilldev/deps.py`**
- 源码对模块职责的说明：SkillDevDeps — SkillDevService 的最小外部依赖定义.。
- `SkillDevDeps` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from typing import Callable`；`from jiuwenswarm.server.runtime.skill.skilldev.store import StateStore`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/deps.py#L1-L37)。
- **`jiuwenswarm/server/runtime/skill/skilldev/pipeline.py`**
- 源码对模块职责的说明：SkillDevPipeline — 确定性状态机编排器.。
- `SkillDevPipeline` 定义类型边界；方法入口：`__init__`, `run`, `resume`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`from typing import AsyncIterator`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L1-L194)。
- **`jiuwenswarm/server/runtime/skill/skilldev/schema.py`**
- 源码对模块职责的说明：SkillDev 模块的核心数据模型.。
- `SkillDevStage` 继承 `str, Enum`。
- `SkillDevTaskMode` 继承 `str, Enum`。
- `SkillDevEventType` 继承 `str, Enum`。
- `SkillDevEvent` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import time`；`from dataclasses import dataclass, field`；`from enum import Enum`。
- 模块级配置或常量名称：`SUSPENSION_POINTS`, `ALLOWED_FRONTMATTER_KEYS`, `SKILL_NAME_MAX_LEN`, `SKILL_DESC_MAX_LEN`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/schema.py#L1-L669)。
- **`jiuwenswarm/server/runtime/skill/skilldev/service.py`**
- 源码对模块职责的说明：SkillDevService — 无状态请求处理器.。
- `SkillDevService` 定义类型边界；方法入口：`__init__`, `handle`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import base64`；`import logging`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L1-L360)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/__init__.py`**
- 源码对模块职责的说明：SkillDev Pipeline 各阶段处理器.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.server.runtime.skill.skilldev.stages.base import StageHand`；`from jiuwenswarm.server.runtime.skill.skilldev.stages.init_stage import Ini`；`from jiuwenswarm.server.runtime.skill.skilldev.stages.plan_stage import Pla`；
  - `from jiuwenswarm.server.runtime.skill.skilldev.stages.generate_stage import`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/__init__.py#L1-L34)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/base.py`**
- 源码对模块职责的说明：StageHandler 基类和 StageResult.。
- `StageResult` 定义类型边界。
- `StageHandler` 继承 `ABC`；方法入口：`execute`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from abc import ABC, abstractmethod`；`from dataclasses import dataclass`；`from jiuwenswarm.server.runtime.skill.skilldev.schema import SkillDevStage`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/base.py#L1-L40)。
- **`jiuwenswarm/server/runtime/skill/skilldev/stages/desc_optimize_stage.py`**
- 源码对模块职责的说明：DESC_OPTIMIZE 阶段处理器.。
- `DescOptimizeStageHandler` 继承 `StageHandler`；方法入口：`execute`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import random`。
- 模块级配置或常量名称：`MAX_ITERATIONS`, `HOLDOUT_RATIO`, `TRIGGER_QUERY_GEN_PROMPT`, `IMPROVE_DESC_PROMPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/stages/desc_optimize_stage.py#L1-L394)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-skill/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
