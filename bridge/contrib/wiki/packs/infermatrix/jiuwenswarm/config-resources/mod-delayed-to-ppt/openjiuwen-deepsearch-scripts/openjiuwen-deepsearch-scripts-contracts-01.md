---
name: openjiuwen-deepsearch-scripts-contracts-01
description: openjiuwen-deepsearch-scripts 源码接口记录 01：openJiuwen-DeepSearch 技能脚本（主脚本、docx/html 转换、环境与技能结构校验）；覆盖 convert_docx.py、convert_html.py、main.py、validate_environment.py、verify_skill_structure.py
metadata:
  scope: 只收 openjiuwen-deepsearch-scripts 下这 5 个源文件的逐文件接口记录；本目录入口归 openjiuwen-deepsearch-scripts-overview
---
# openjiuwen-deepsearch-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/convert_docx.py`**
- 调用入口 `ensure_pandoc()`。
- 调用入口 `clean_mermaid_code(code)`；声明返回 `str`。
- 调用入口 `enhance_image(image_path)`。
- 调用入口 `render_mermaid(code, output_path)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import os`；`import re`；`import base64`；`import logging`。
- 模块级配置或常量名称：`DEFAULT_CONFIG`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/convert_docx.py#L1-L422)。
- **`jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/convert_html.py`**
- 调用入口 `read_text_with_fallback(path)`；声明返回 `str`。
- 调用入口 `normalize_whitespace_and_units(text)`；声明返回 `str`。
- 调用入口 `replace_citations(text)`；声明返回 `str`。
- 调用入口 `normalize_reference_lines(text)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from pathlib import Path`；`import html`；`import math`；`import re`。
- 模块级配置或常量名称：`HTML_TEMPLATE`, `CITATION_RE`, `REFERENCE_LINE_RE`, `MERMAID_BLOCK_RE`, `LATIN_UNITS`, `CHINESE_UNITS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/convert_html.py#L1-L630)。
- **`jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py`**
- 源码对模块职责的说明：openJiuwen-DeepSearch 主脚本。
- 异步入口 `run_jiuwen_workflow(query, agent_config)`。
- 调用入口 `load_agent_config()`；声明返回 `dict`。
- 调用入口 `execute_deep_search(query)`；声明返回 `str / None`。
- 调用入口 `run_background()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import asyncio`；`import datetime`；`import json`。
- 模块级配置或常量名称：`CHECKED_CITATION_RE`, `LEGACY_CITATION_RE`, `SKILL_ROOT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L1-L339)。
- **`jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/validate_environment.py`**
- 源码对模块职责的说明：DeepSearch 环境验证和参数检查脚本。
- 调用入口 `check_main_py()`。
- 调用入口 `check_api_keys()`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import sys`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/validate_environment.py#L1-L80)。
- **`jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/verify_skill_structure.py`**
- 源码对模块职责的说明：技能结构验证脚本。
- 调用入口 `check_skill_structure(skill_root)`；声明返回 `bool`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import sys`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/verify_skill_structure.py#L1-L173)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/openjiuwen-deepsearch-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
