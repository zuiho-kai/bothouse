---
name: feature-depth-xlsx-add-computed-column
description: xlsx_add_column.py 实现深读：main 流程与 return 0、缺省值与条件样式、_xlsx_common 依赖与 resolve_worksheet 的 SystemExit、--border-row 重置 fontId/fillId 的取舍、SKILL.md 手工流程（未执行）
metadata:
  scope: 收 xlsx_add_column.py 的实现细节（main、缺省值、依赖与失败路径、边框取舍、手工验证记载），来源另含 SKILL.md、_xlsx_common.py；功能概览归 feature-xlsx-add-computed-column
---
# XLSX Computed Column Adder：实现深读

## 现状

- [[feature-xlsx-add-computed-column]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main(): resolve sheet, patch styles, write header/formula/total cells, then repack-ready save** main() splits the target column ref, resolves the worksheet (defaulting to the first sheet name from workbook.xml), builds Styles, adds numfmt/border entries, writes optional header,
  - formula cells for --formula-rows via {row} substitution, optional total cell, optional row-wide top border, then sorts sheetData, updates dimension, saves styles and writes the worksheet XML, printing "added column <col> on '<sheet>'".
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L67–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L67-L115)
- **main()：位置参数 workdir 加 --col（必填）等选项，成功后打印并局部 return 0** 命令行契约：位置参数 workdir，--col 必填；--header-row 默认 1，--border-style 默认 "medium"，--sheet/--header/--formula/--formula-rows/--total-row/--total-formula/--numfmt/--border-row 可选。
  - 成功路径先排序、更新 dimension、保存 styles 与 worksheet XML，打印 "added column …" 后局部 return 0（不构成进程退出码证明）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L51–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L51-L65),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L111–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L111-L116)
- **Defaults within main(): header-row 1, border-style "medium", sheet falls back to first sheet** When --sheet is omitted, sheet = X.first_sheet_name(args.workdir), i.e. the first <sheet> in xl/workbook.xml.
  - --header-row defaults to 1 and --border-style defaults to "medium"; style wiring is conditional: data_xf is created only if a --numfmt was given, and total_xf/border styles only if --border-row is set.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L57–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L57-L78)
- **Imports _xlsx_common and resolves the target sheet through workbook.xml and its .rels** xlsx_add_column.py imports _xlsx_common as X and uses its first_sheet_name/resolve_worksheet/Styles helpers;
  - resolve_worksheet maps the sheet display name to an r:id in xl/workbook.xml and then to a Target in xl/_rels/workbook.xml.rels, raising SystemExit("sheet not found: …") or "relationship not found…" when either lookup fails.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L21–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L21-L25),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L67–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L67-L78),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L50–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L50-L77)
- **Sheet resolution failures raise SystemExit with message;
  - border pass preserves each cell's numFmtId** resolve_worksheet raises SystemExit("sheet not found: <name>") when the display name is absent from workbook.xml and SystemExit("relationship not found for sheet: ...") when the r:id has no matching relationship entry;
  - first_sheet_name raises SystemExit("no sheets found in workbook.xml") if workbook.xml has no sheet. In the border pass, numfmt_of returns numFmtId 0 when the cell's style index or cellXfs is missing, so add_xf is still applied.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L50–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L50-L77),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L28–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L28-L38),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L105–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L105-L109)
- **--border-row 保留各单元格 numFmtId，但新 xf 将 fontId/fillId 固定为 0 且逐格追加 xf** 设计推断（非作者历史意图）：
- 推断：行级加顶边框时用 numfmt_of 读取原样式的 numFmtId 并写入新 xf，避免破坏数字格式；代价是每个单元格的字体/填充被重置为 fontId="0"、fillId="0"，且 add_xf 为每个单元格追加新 cellXfs 条目而非复用。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L104–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L104-L109),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L28–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py#L28-L38),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L242–L257](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L242-L257)
- **Documented manual edit-and-verify procedure for the add-column flow (NOT EXECUTED)** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md documents a manual procedure: unpack input.xlsx with xlsx_unpack.py, run xlsx_add_column.py (e.g. --col G with --formula '=F{row}/$F$10' --formula-rows 2:9 --total-row 10 --total-formula '=SUM(G2:G9)' --numfmt '0.0%' --border-row 10 --border-style medium),
  - repack with xlsx_pack.py into output.xlsx, then verify with `xlsx_reader.py --diff-against input.xlsx` and confirm original sheet names, named ranges, pivots/macros, and a sample of original data are present; if verification fails, fix before delivering.
  - These steps are documented only and were NOT EXECUTED here.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L97–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md#L97-L108),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L118–L127](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md#L118-L127)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-xlsx-add-computed-column.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L67-L115
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L57-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L50-L77
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L28-L38
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L105-L109
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L21-L25
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L67-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L51-L65
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L111-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py:L104-L109
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L242-L257
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L97-L108；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L118-L127
- 源页字段（feature）：xlsx-add-computed-column
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_add_column.py
