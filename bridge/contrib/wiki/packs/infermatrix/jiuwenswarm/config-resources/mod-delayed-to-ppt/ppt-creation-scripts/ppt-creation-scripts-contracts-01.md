---
name: ppt-creation-scripts-contracts-01
description: ppt-creation-scripts 源码接口记录 01（ppt-creation-scripts 脚本共两页之一）：覆盖 audit_pptx.py、components.js、demo_components.js、extract_arxiv_visuals_v2_2.py、figure-panel.js、fill_cover.py、finalize_deck.py、make_blank_template.py 等共 12 个文件
metadata:
  scope: 只收 ppt-creation-scripts 下这 12 个源文件的逐文件接口记录；本目录入口归 ppt-creation-scripts-overview，其余文件的接口记录归 ppt-creation-scripts-contracts-02
---
# ppt-creation-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py`**
- 源码对模块职责的说明：Structural and readability audit for generated PPTX files.。
- 调用入口 `emit(line)`；声明返回 `None`。
- 调用入口 `local(tag)`；声明返回 `str`。
- 调用入口 `xml(zf, name)`；声明返回 `ET.Element`。
- 调用入口 `slide_size(zf)`；声明返回 `tuple[int, int]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import hashlib`；`import json`。
- 模块级配置或常量名称：`LOGGER`, `STDOUT_LOGGER`, `NS`, `SOURCE_NOTE_RE`, `FOOTER_BAND_TOP`, `COMPAT_CANVAS_W`, `COMPAT_CANVAS_H`, `TOC_ROLES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/audit_pptx.py#L1-L538)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js`**
- 源码声明的类型、组件或调用边界：`path`, `DIAGRAM_DENSITY`, `THEME`, `FONT`, `cardShadow`, `TY`, `LAYOUT`, `FOOTER_MARK`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const path = require("path");`；`const { renderSystemDiagram, DEFAULT_THEME, item, group, bandNode, groupBand } = require(path.join(_`；`const { renderFigurePanel } = require(path.join(__dirname, "figure-panel.js"));`；
  - `sharp = require(require.resolve("sharp", { paths: [process.cwd(), __dirname] }));`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/components.js#L1-L2063)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/demo_components.js`**
- 源码声明的类型、组件或调用边界：`pptxgen`, `C`, `main`, `pres`, `s`, `gy`, `gy`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const pptxgen = require(require.resolve("pptxgenjs", { paths: [process.cwd(), __dirname] }));`；`const C = require(require("path").join(__dirname, "components.js"));`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/demo_components.js#L1-L252)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py`**
- 源码对模块职责的说明：Cross-platform paper figure/table extractor.。
- 调用入口 `emit(line)`；声明返回 `None`。
- 调用入口 `eprint(*args)`；声明返回 `None`。
- 调用入口 `log(message)`；声明返回 `None`。
- 调用入口 `warn(message)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import contextlib`；`import hashlib`。
- 模块级配置或常量名称：`SCRIPT_VERSION`, `DEFAULT_DPI`, `DEFAULT_DEBUG_DPI`, `DEPENDENCIES`, `LOGGER`, `STDOUT_LOGGER`, `AUTO_INSTALL`, `ARXIV_ID_RE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/extract_arxiv_visuals_v2_2.py#L1-L1475)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js`**
- 源码声明的类型、组件或调用边界：`fs`, `WIDE_AR`, `LABEL_H`, `GAP`, `LABEL_FONT`, `LABEL_COLOR`, `pngSize`, `fd`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const fs = require("fs");`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/figure-panel.js#L1-L104)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/fill_cover.py`**
- 源码对模块职责的说明：scripts/fill_cover.py Fill the official cover slide's title and 部门/作者/日期 placeholders in an unpacked PPTX directory.。
- `FillCoverError` 继承 `RuntimeError`。
- 调用入口 `emit(line)`。
- 调用入口 `read(path)`。
- 调用入口 `write(path, text)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import sys`；`import re`；`from pathlib import Path`。
- 模块级配置或常量名称：`LOGGER`, `ACCENT`, `TITLE_RUN`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/fill_cover.py#L1-L194)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py`**
- 源码对模块职责的说明：One-command deck finalize: merge generated content slides into the template and emit the packed PPTX.。
- `FinalizeError` 继承 `RuntimeError`。
- 调用入口 `emit(line)`。
- 调用入口 `run(argv, step)`。
- 调用入口 `count_slides(unpacked)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import re`；`import shutil`；`import subprocess`。
- 模块级配置或常量名称：`LOGGER`, `SCRIPTS`, `SKILL_ROOT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/finalize_deck.py#L1-L201)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/make_blank_template.py`**
- 源码对模块职责的说明：Generate references/template.pptx — the neutral blank deck template.。
- 调用入口 `emit(line)`。
- 调用入口 `style(run, size, color, bold)`。
- 调用入口 `build_cover(pres)`。
- 调用入口 `build_toc(pres)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import sys`；`from argparse import ArgumentParser`；`from pathlib import Path`。
- 模块级配置或常量名称：`LOGGER`, `SKILL_ROOT`, `ACCENT`, `TEXT`, `CJK_FONT`, `LAYOUT_TITLE`, `LAYOUT_TITLE_ONLY`, `LAYOUT_BLANK`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/make_blank_template.py#L1-L181)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py`**
- 源码对模块职责的说明：scripts/merge_slides.py Merge pptxgenjs content slides into a template unpacked directory.。
- 调用入口 `emit(line)`。
- 调用入口 `read(path)`。
- 调用入口 `write(path, content)`。
- 调用入口 `slide_size(pptx_dir)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import sys`；`import os`；`import re`。
- 模块级配置或常量名称：`LOGGER`, `CHART_CT`, `XLSX_CT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/merge_slides.py#L1-L642)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py`**
- 源码对模块职责的说明：Add a slide to an unpacked PPTX, by copying one or starting from a layout.。
- `AddSlideError` 继承 `RuntimeError`。
- 调用入口 `emit(line)`。
- 调用入口 `next_free(slides_dir)`；声明返回 `int`。
- 调用入口 `next_rel_id(rels_text)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import argparse`；`import re`；`import shutil`。
- 模块级配置或常量名称：`LOGGER`, `SLIDE_CT`, `SLIDE_REL_TYPE`, `LAYOUT_REL_TYPE`, `EMPTY_SLIDE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/add_slide.py#L1-L186)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py`**
- 源码对模块职责的说明：Pack an unpacked OOXML directory back into a .pptx/.docx/.xlsx.。
- `PackError` 继承 `RuntimeError`。
- 调用入口 `emit(line)`。
- 调用入口 `condense(path)`；声明返回 `None`。
- 调用入口 `pack(unpacked, output, do_repair, do_validate, original)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import argparse`；`import shutil`；`import sys`。
- 模块级配置或常量名称：`LOGGER`, `SUPPORTED`, `FIRST_ENTRY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/pack.py#L1-L156)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/prune.py`**
- 源码对模块职责的说明：Drop unreferenced parts from an unpacked OOXML package.。
- 调用入口 `emit(line)`。
- 调用入口 `rels_path_for(part, root)`；声明返回 `Path`。
- 调用入口 `targets_of(rels_file, root)`；声明返回 `list[Path]`。
- 调用入口 `reachable_parts(root)`；声明返回 `set[Path]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import argparse`；`import re`；`import sys`。
- 模块级配置或常量名称：`LOGGER`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/opc/prune.py#L1-L195)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/ppt-creation-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
