---
name: feature-xlsx-formula-check
description: XLSX 公式静态校验 formula_check.py：命令行与退出码 0/1/2、七个固定错误令牌、缓存值与公式文本两遍只读扫描、子串匹配误报、依赖 openpyxl
metadata:
  scope: 只收 formula_check.py 的功能概览（CLI 与退出码、错误令牌表、检测范围、分层、取舍、验证行为）；实现深读归 feature-depth-xlsx-formula-check
---
# XLSX 公式静态校验（formula_check.py）

## 现状

- **命令行入口与退出码**
- 以 CLI 脚本形式提供：`python3 formula_check.py file.xlsx [--json] [--report]`，positional 参数为工作簿路径，`--json` 输出 `{"ok": bool, "issues": [...]}` 的 JSON，否则打印人类可读报告。退出码约定为 0=未发现问题、1=发现问题、2=用法错误（openpyxl 导入失败也直接 `sys.exit(2)`）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L5–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L5-L11),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L60–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L60-L79)
- **固定的错误令牌表**
- 唯一的配置点是模块级常量 `ERROR_TOKENS`，硬编码七个 Excel 错误令牌：`#REF!`、`#DIV/0!`、`#VALUE!`、`#N/A`、`#NAME?`、`#NULL!`、`#NUM!`，无环境变量或配置文件，不支持用户扩展。命令行仅有 `--json`/`--report` 两个布尔开关（`--report` 解析后未在代码中被使用）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L24–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L24-L24),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L60–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L60-L65)
- **支持的检测范围与依赖**
- 检测缓存值和公式文本中的 Excel 错误令牌，是纯静态检查，不执行公式；docstring 明确指出如需新鲜缓存值应先运行同目录的 `libreoffice_recalc.py`。依赖 openpyxl（`load_workbook`、`get_column_letter`），缺失时打印 stderr 提示并以退出码 2 结束。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L9–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L9-L11),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L17–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L17-L22)
- **扫描与输出的分层**
- 脚本由 `_scan(path)` 与 `main()` 两层组成。`_scan` 对同一工作簿做两遍遍历：先用 `load_workbook(data_only=True)` 扫描缓存值，再用 `data_only=False` 扫描以 `=` 开头的公式文本，命中 `ERROR_TOKENS` 时收集 `{sheet, cell, type, detail}` 问题项（L27–L57）。
  - `main()` 负责解析 `--json`/`--report` 参数、调用 `_scan`（L67）、据 `len(issues) == 0` 判定结果（L68）并按 JSON 或人类可读格式输出、返回 0/1 退出码（L69–L79）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L27–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L27-L57),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L60–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L60-L79)
- **子串匹配与双遍扫描的代价**
- 检测采用纯静态的子串包含判断（`tok in v`）：只要字符串值或公式文本中包含任一错误令牌即报告，因此像包含 "#N/A" 的普通文本会被当作命中，存在误报的可能（L35–L41、L49–L55）。为同时覆盖缓存值和公式文本，脚本以两个不同的 `data_only` 设置、均 `read_only=True` 打开文件并各遍历一次（L30、L44），换取简单性，代价是需要两遍遍历。错误令牌表为硬编码常量，不可配置（L24）。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L30–L44](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L30-L44),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L49–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L49-L55)
- **可观察的验证行为**
- 脚本自身通过退出码与输出暴露结果：未发现问题时退出码 0，发现问题退出码 1，docstring 另约定 2 为用法错误（L9，L79）。`--json` 时输出 `{"ok": bool, "issues": [...]}` 结构化结果（L69–L70），人类可读模式逐条打印 `[type] sheet!cell -> detail`（L75–L78）。所提供的文件中未展示针对该脚本的自动化测试入口；本条仅描述脚本内可观察的验证行为。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L3–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L3-L11),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L67–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L67-L79)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-xlsx-formula-check.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L5-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L60-L79
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L24-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L60-L65
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L9-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L17-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L27-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L30-L44
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L49-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L3-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L67-L79
- 源页字段（feature）：xlsx-formula-check
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py
