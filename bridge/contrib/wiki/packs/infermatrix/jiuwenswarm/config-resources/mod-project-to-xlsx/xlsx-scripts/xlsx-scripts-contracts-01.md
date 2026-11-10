---
name: xlsx-scripts-contracts-01
description: xlsx-scripts 源码接口与集成边界 01：skills/xlsx/scripts 下 _xlsx_common、doctor、formula_check、libreoffice_recalc、xlsx_add_column、xlsx_insert_row、xlsx_pack、xlsx_reader、xlsx_render、xlsx_shift_rows、xlsx_unpack 十一个脚本的静态声明
metadata:
  scope: 只收这十一个脚本的函数、导入与常量名称声明，不证明运行行为；入口说明归 xlsx-scripts-overview
---
# xlsx-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py`**
- 源码对模块职责的说明：Shared helpers for the XLSX XML-editing scripts.。
- 调用入口 `col_to_num(col)`。
- 调用入口 `num_to_col(n)`。
- 调用入口 `split_ref(ref)`。
- 调用入口 `parse(path)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import os`；`import re`；`from lxml import etree`。
- 模块级配置或常量名称：`MAIN`, `RNS`, `XMLNS`, `M`, `R`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L1-L260)。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py`**
- 源码对模块职责的说明：doctor.py - Environment & dependency self-check for the XLSX skill.。
- 调用入口 `check_python(results)`。
- 调用入口 `check_py_deps(results)`。
- 调用入口 `check_cli(results)`。
- 调用入口 `check_cjk_font(results)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import importlib`；`import json`；`import shutil`。
- 模块级配置或常量名称：`PY_DEPS`, `CLI_TOOLS`, `CJK_FONT_HINTS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L1-L134)。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py`**
- 源码对模块职责的说明：formula_check.py - Static validation of a workbook's formulas & cached values.。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import json`；`import sys`。
- 模块级配置或常量名称：`ERROR_TOKENS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L1-L83)。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/libreoffice_recalc.py`**
- 源码对模块职责的说明：libreoffice_recalc.py - Recalculate formulas and write back cached values.。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import os`；`import shutil`；`import subprocess`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/libreoffice_recalc.py#L1-L70)。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py`**
- 源码对模块职责的说明：xlsx_add_column.py - Add a computed column to an unpacked workbook dir.。
- 调用入口 `numfmt_of(st, sidx)`。
- 调用入口 `style_of(sd, col, rownum)`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import sys`；`import _xlsx_common as X`；`from _xlsx_common import M`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L1-L120)。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py`**
- 源码对模块职责的说明：xlsx_insert_row.py - Insert a row into an unpacked workbook dir.。
- 调用入口 `parse_pairs(items)`。
- 调用入口 `style_of(sd, col, rownum)`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import sys`；`import _xlsx_common as X`；`from _xlsx_common import M`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L1-L95)。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py`**
- 源码对模块职责的说明：xlsx_pack.py - Repack a directory into a valid .xlsx/.xlsm.。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import os`；`import sys`；`import zipfile`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_pack.py#L1-L58)。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py`**
- 源码对模块职责的说明：xlsx_reader.py - Structure discovery + structural diff for the XLSX skill.。
- 调用入口 `describe(path)`。
- 调用入口 `preview(path, sheet, n)`。
- 调用入口 `diff_against(new_path, old_path)`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import json`；`import sys`；`import zipfile`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_reader.py#L1-L200)。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_render.py`**
- 源码对模块职责的说明：xlsx_render.py - Render a workbook to PNG/PDF for visual review, with CJK fonts.。
- 调用入口 `to_pdf(src, outdir)`。
- 调用入口 `pdf_to_pngs(pdf, outdir, prefix)`。
- 调用入口 `render(src, outdir, pdf_only)`。
- 调用入口 `render_diff_html(old_src, new_src, html_path)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import base64`；`import glob`；`import os`。
- 模块级配置或常量名称：`CJK_FONT_CANDIDATES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_render.py#L1-L169)。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_shift_rows.py`**
- 源码对模块职责的说明：xlsx_shift_rows.py - Low-level row shifter on an unpacked workbook dir.。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import sys`；`import _xlsx_common as X`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_shift_rows.py#L1-L50)。
- **`jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py`**
- 源码对模块职责的说明：xlsx_unpack.py - Unpack a workbook (ZIP of XML parts) into a directory.。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import os`；`import sys`；`import zipfile`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_unpack.py#L1-L42)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/xlsx-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
