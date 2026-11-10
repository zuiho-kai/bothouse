---
name: docx-pro-scripts-contracts-01
description: docx-pro-scripts 源码接口记录 01：docx-pro 技能脚本（Word 命令行主入口、文本替换、Markdown 导入导出、渲染与依赖自检）；覆盖 docx_pro.py、docx_replace.py、md_export.py、md_parser.py、renderer.py、setup_check.py
metadata:
  scope: 只收 docx-pro-scripts 下这 6 个源文件的逐文件接口记录；本目录入口归 docx-pro-scripts-overview
---
# docx-pro-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py`**
- 源码对模块职责的说明：docx_pro.py - 专业 Word 文档操作命令行工具（docx-pro 技能主入口）。
- 调用入口 `cmd_create(args)`。
- 调用入口 `cmd_from_md(args)`。
- 调用入口 `cmd_to_md(args)`。
- 调用入口 `cmd_replace(args)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import io`；`import json`；`import logging`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_pro.py#L1-L425)。
- **`jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py`**
- 源码对模块职责的说明：docx_replace.py - Word (.docx) 保真文本替换引擎（docx-pro 技能）。
- 调用入口 `replace_in_xml(xml_text, old, new, case_sensitive, count_only)`。
- 调用入口 `replace_in_docx(src, dst, pairs, **options)`。
- 调用入口 `count_in_docx(path, old, scope, case_sensitive)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import bisect`；`import json`；`import re`；`import zipfile`。
- 模块级配置或常量名称：`SENTINEL`, `WT_RE`, `BREAK_PAT`, `REPLACE_ALL_PARTS`, `REPLACE_ALL_PREFIXES`, `REPLACE_BODY_PARTS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/docx_replace.py#L1-L348)。
- **`jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/md_export.py`**
- 源码对模块职责的说明：docx -&gt; Markdown 导出器。。
- 调用入口 `docx_to_markdown(path, images_dir)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import os`；`import re`；`from docx import Document`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/md_export.py#L1-L229)。
- **`jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/md_parser.py`**
- 源码对模块职责的说明：Markdown -&gt; docx-pro 大纲 解析器。。
- 调用入口 `parse_markdown(md_text, base_dir)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import os`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/md_parser.py#L1-L225)。
- **`jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/renderer.py`**
- 源码对模块职责的说明：docx-pro 渲染引擎：主题系统 + 文档块渲染器。。
- 调用入口 `get_theme(name)`。
- 调用入口 `parse_inline(text)`。
- 调用入口 `add_runs(p, spec, theme, **options)`。
- 调用入口 `add_hyperlink(p, url, text, theme, size)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import os`；`import re`；`from xml.sax.saxutils import escape`；`from docx import Document`。
- 模块级配置或常量名称：`THEMES`, `DEFAULT_THEME`, `INLINE_TOKEN_RE`, `BLOCK_RENDERERS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/renderer.py#L1-L714)。
- **`jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py`**
- 源码对模块职责的说明：docx-pro 依赖自检：确认 python-docx 可用。。
- 调用入口 `check()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/docx-pro/scripts/setup_check.py#L1-L30)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/docx-pro-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
