---
name: feature-xlsx-doctor-selfcheck
description: XLSX 技能环境自检 doctor.py：四类检查（Python、openpyxl/pandas/lxml、soffice 与 pdftoppm、CJK 字体）、--json 输出、退出码 0/1、字体两级探测取舍
metadata:
  scope: 只收 doctor.py 的功能概览（数据流、检查项、入口与退出码、常量与阈值、探测取舍、可验证行为）；实现深读归 feature-depth-xlsx-doctor-selfcheck
---
# XLSX 技能环境自检（doctor.py）

## 现状

- **职责与数据流**
- doctor.py 是 XLSX 技能脚本目录下的独立自检工具，不依赖技能内其他模块，只做环境探测、不做修复。控制流集中在 `main()`：按序调用 `check_python`、`check_py_deps`、`check_cli`、`check_cjk_font`，四个检查函数都向同一个 `results` 列表追加 `{check, ok, detail, required}` 字典；最终以 `required and not ok` 过滤出必需项失败来决定整体 ok 与退出码，最后统一渲染为文本或 JSON。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L40–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L40-L47),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L109–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L109-L119)
- **检查项与依赖关系**
- 覆盖四类检查：Python 版本、三个 pip 依赖（用 importlib 实际导入并读取 `__version__`）、两个外部 CLI 工具（用 `shutil.which` 定位），以及 CJK 字体。字体检查先用 `fc-list :lang=zh family` 列出支持中文的字族（最多展示 8 个），失败时退回对全量字族列表按 `CJK_FONT_HINTS` 名称提示做大小写不敏感的子串扫描；注释说明缺字体时中文在 PNG/PDF 中会渲染成方框。这暗示该技能的渲染链路依赖 libreoffice + poppler（推断：具体消费方脚本未在本次展示中）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L50–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L50-L71),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L74–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L74-L101)
- **入口、输出与退出码契约**
- doctor.py 以 shebang 脚本形式提供，文档用法为 `python3 doctor.py [--json]`，也可经 `main()` 调用；`--json` 时输出 `{ok, results}` 的机器可读 JSON（ensure_ascii=False、缩进 2），否则打印逐项 PASS/FAIL/warn 文本报表和总结行。退出码契约：所有 `required` 检查通过返回 0，任一必需项失败返回 1；可选项失败仅标记 warn，不影响退出码。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L8–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L8-L11),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L115–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L115-L130)
- **检查清单常量与阈值位置**
- 被检查对象由模块顶部常量定义：`PY_DEPS` 列出 openpyxl、pandas（必需）与 lxml（可选）；`CLI_TOOLS` 列出 soffice/libreoffice 与 pdftoppm/poppler-utils（均必需）；`CJK_FONT_HINTS` 给出十个体面（family）名称提示，任一命中即算有 CJK 字体。Python 版本阈值 (3, 8) 不在常量里，而是直接写在 `check_python` 的比较表达式中。命令行仅显式定义 `--json` 一个开关（ArgumentParser 默认还附带帮助行为）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L20–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L20-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L40–L46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L40-L46),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L104–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L104-L107)
- **探测方式的取舍**
- Inference / 设计推断（非作者历史意图）：
- 字体检查采取两级策略：优先 `fc-list :lang=zh family` 精确查询，无结果时退回对全量字族列表按 `CJK_FONT_HINTS` 做大小写不敏感子串扫描，两次子进程调用均设 20 秒超时且异常被吞掉——以尽力给出结果换取对 fontconfig 环境的依赖。字体缺失被标记为必需失败（退出码 1），detail 仅提示安装建议并警告中文文本在 PNG/PDF 中会渲染成方框（推断：把渲染质量问题提升为环境不达标，是面向中文场景的保守选择）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L74–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L74-L101),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L115–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L115-L116)
- **可验证行为**
- 脚本自身即可作为验证入口：直接运行会依次执行 Python 版本、三个 pip 依赖导入、两个 CLI 定位和 CJK 字体共四组检查，`--json` 输出逐项 `{check, ok, detail, required}`，可用于核对面板结果与退出码是否一致。本次展示的输入中未包含针对 doctor.py 的测试文件；`main()` 为普通函数，检查函数各自接收 results 列表，具备被自动化测试分别调用的形态。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L40–L46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L40-L46),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L109–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L109-L119),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L133–L134](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L133-L134)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-xlsx-doctor-selfcheck.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L40-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L109-L119
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L50-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L74-L101
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L8-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L115-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L20-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L40-L46
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L104-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L115-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L133-L134
- 源页字段（feature）：xlsx-doctor-selfcheck
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py
