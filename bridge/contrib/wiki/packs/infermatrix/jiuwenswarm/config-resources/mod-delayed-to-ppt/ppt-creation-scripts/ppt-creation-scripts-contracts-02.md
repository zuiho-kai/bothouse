---
name: ppt-creation-scripts-contracts-02
description: ppt-creation-scripts 源码接口记录 02（ppt-creation-scripts 脚本共两页之一）：覆盖 repair.py、thumbnail.py、unpack.py、validate.py、prepare_evidence.py、qa_density.py、qa_geometry.py、sync-runtime-skill.js 等共 11 个文件
metadata:
  scope: 只收 ppt-creation-scripts 下这 11 个源文件的逐文件接口记录；本目录入口归 ppt-creation-scripts-overview，其余文件的接口记录归 ppt-creation-scripts-contracts-01
---
# ppt-creation-scripts 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py`**
- 源码对模块职责的说明：Normalize generator quirks in unpacked OOXML before packing.。
- 调用入口 `emit(line)`。
- 调用入口 `fix_bullet_sizes(text)`；声明返回 `tuple[str, int]`。
- 调用入口 `fix_negative_extents(text)`；声明返回 `tuple[str, int]`。
- 调用入口 `fix_shadow_values(text)`；声明返回 `tuple[str, int]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import argparse`；`import re`；`import sys`。
- 模块级配置或常量名称：`LOGGER`, `RULES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/repair.py#L1-L217)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py`**
- 源码对模块职责的说明：Render a deck to a labelled grid of slide thumbnails.。
- `ThumbnailError` 继承 `RuntimeError`。
- 调用入口 `emit(line)`。
- 调用入口 `find_soffice()`；声明返回 `str`。
- 调用入口 `render_pages(deck, workdir)`；声明返回 `list[Image.Image]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import argparse`；`import shutil`；`import subprocess`。
- 模块级配置或常量名称：`LOGGER`, `CELL_W`, `LABEL_H`, `PAD`, `MAX_PER_SHEET`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/thumbnail.py#L1-L144)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/unpack.py`**
- 源码对模块职责的说明：Unpack an OOXML package (.pptx/.docx/.xlsx) into an editable directory.。
- `UnpackError` 继承 `RuntimeError`。
- 调用入口 `emit(line)`。
- 调用入口 `pretty_print(path)`；声明返回 `bool`。
- 调用入口 `unpack(archive, target)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import argparse`；`import sys`；`import zipfile`。
- 模块级配置或常量名称：`LOGGER`, `SUPPORTED`, `XML_PATTERNS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/unpack.py#L1-L120)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py`**
- 源码对模块职责的说明：Validate an unpacked OOXML package against the published ECMA/ISO schemas.。
- 调用入口 `emit(line)`。
- 调用入口 `schema_for(root_ns)`。
- 调用入口 `validate_schemas(unpacked)`；声明返回 `list[str]`。
- 调用入口 `validate_structure(unpacked)`；声明返回 `list[str]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import argparse`；`import re`；`import sys`。
- 模块级配置或常量名称：`LOGGER`, `SCHEMA_ROOT`, `NS_TO_XSD`, `SKIP_PARTS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/validate.py#L1-L218)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py`**
- 源码对模块职责的说明：Prepare evidence assets declared in evidence-plan.json.。
- 调用入口 `emit(line)`；声明返回 `None`。
- 调用入口 `nonempty(value)`；声明返回 `bool`。
- 调用入口 `resolve(root, value)`；声明返回 `Path / None`。
- 调用入口 `save_plan(path, plan)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import hashlib`；`import json`。
- 模块级配置或常量名称：`LOGGER`, `STDOUT_LOGGER`, `FILE_COPY_ROUTES`, `PATH_BEARING_ROUTES`, `PREPARABLE_STATUSES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/prepare_evidence.py#L1-L360)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py`**
- 源码对模块职责的说明：Per-page text-volume gate.。
- 调用入口 `emit(line)`。
- 调用入口 `vis_len(text)`。
- 调用入口 `slide_chars(pptx)`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import json`；`import logging`；`import re`；`import sys`。
- 模块级配置或常量名称：`FLOOR_HARD`, `FLOOR_WARN`, `TARGET`, `STDOUT_LOGGER`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_density.py#L1-L115)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py`**
- 源码对模块职责的说明：几何自检：直接解析 .pptx，抓重叠、遮挡、越界和轴线不齐。。
- 调用入口 `emit(line)`；声明返回 `None`。
- `Offset` 定义类型边界。
- `Element` 定义类型边界；方法入口：`x2`, `y2`, `area`, `has_text`, `label`。
- 调用入口 `intersect(a, b)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import json`；`import logging`；`import re`。
- 模块级配置或常量名称：`EMU_PER_INCH`, `SUMMARY_TOP`, `NS`, `STDOUT_LOGGER`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/qa_geometry.py#L1-L486)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/sync-runtime-skill.js`**
- 源码声明的类型、组件或调用边界：`fs`, `path`, `crypto`, `SRC`, `DST`, `AGENT_DATA`, `EXCLUDE_DIRS`, `EXCLUDE_EXT`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const fs = require("fs");`；`const path = require("path");`；`const crypto = require("crypto");`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/sync-runtime-skill.js#L1-L179)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js`**
- 源码声明的类型、组件或调用边界：`FONT`, `DEFAULT_COLORS`, `DEFAULT_THEME`, `SHAPE_TYPE`, `COLORS`, `FONT_MIN`, `FONT_MAX`, `PAGE_W`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/system-diagram.js#L1-L874)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js`**
- 源码声明的类型、组件或调用边界：`fs`, `path`, `FILE_ROUTES`, `ROUTES`, `KINDS`, `STATUSES`, `REVIEW_STATUSES`, `PLACEMENT_ROLES`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const fs = require("fs");`；`const path = require("path");`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js#L1-L133)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js`**
- 源码声明的类型、组件或调用边界：`fs`, `path`, `args`, `phaseIndex`, `phase`, `lockArg`, `lockPath`, `projectRoot`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const fs = require("fs");`；`const path = require("path");`；`const { validateEvidencePlan } = require("./validate-evidence-plan.js");`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L1-L252)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/ppt-creation-scripts/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
