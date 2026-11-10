---
name: feature-depth-xlsx-insert-row
description: xlsx_insert_row.py 实现深读：main 步骤顺序、CLI 与默认值、SystemExit 失败路径、extend_ranges 只改两单元格范围的取舍、SKILL.md 手工流程（未执行）、_xlsx_common 与 lxml 依赖
metadata:
  scope: 收 xlsx_insert_row.py 的实现细节（main、CLI、默认值、失败路径、范围扩展取舍、手工验证记载、依赖），来源另含 SKILL.md、_xlsx_common.py；功能概览归 feature-xlsx-insert-row
---
# XLSX Row Insert with Range Extension：实现深读

## 现状

- [[feature-xlsx-insert-row]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main()：解析工作表，移位行，扩展范围，写入单元格，排序/更新维度/写入并打印** main() 解析参数，解析工作表 XML（使用 --sheet 或第一个工作表），调用 X.shift_rows(sd, args.at, 1) 然后调用 X.extend_ranges(sd, args.at, 1)，通过 get_or_make_row 在 --at 位置构建行，写入来自 --text/--values/--formula 的单元格（其中 {row} 被替换为 --at），然后 sort_sheetdata、update_dimension、write，
  - 并打印 "inserted row at N on 'S'"；该函数局部返回 0。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L60–L91](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L60-L91)
- **CLI：位置参数 workdir，必填整数 --at，可选 --sheet/--text/--values/--formula/--copy-style-from** 接收一个解包后的工作簿目录（workdir）作为位置参数，--at 为必填整数；--text/--values/--formula 为 COL=VALUE 对（缺失 '=' 则通过 SystemExit 终止），公式中的 {row} 会被替换为 --at；输出直接写入工作表 XML，文档字符串指出需使用 xlsx_pack.py 重新打包，并在之后进行验证。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L3–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L3-L20),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L50–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L50-L58),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L29–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L29-L36)
- **默认值：工作表回退至 first_sheet_name，pair 列表默认为 []，样式仅在 truthy --copy-style-from 时生效** 当省略 --sheet 时，工作表为 X.first_sheet_name(args.workdir)（workbook.xml 中的第一个 <sheet>）；--text/--values/--formula 默认为空列表；
  - st_for(col) 返回 style_of(...) 仅当 args.copy_style_from 为 truthy 时，否则为 None，且 make_cell 仅在 style 不为 None 时设置 's' 属性。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L53–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L53-L60),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L71–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L71-L78),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L96–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L96-L100),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L50–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L50-L54)
- **通过 SystemExit 停止：格式错误的 COL=VALUE 对、没有工作表，以及未找到工作表** parse_pairs 在任何没有 '=' 的项上引发 SystemExit("expected COL=VALUE, got: …")；first_sheet_name 在 workbook.xml 没有工作表时引发 SystemExit("no sheets found in workbook.xml")；resolve_worksheet 在名称不匹配任何工作表时引发 SystemExit("sheet not found: …")。
  - 这些错误通过 sys.exit(main()) 从正在运行的脚本中传播出来。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L29–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L29-L36),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L50–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L50-L66),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L94–L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L94-L95)
- **extend_ranges is best-effort: A1:B9-style totals ranges are bumped, single-cell refs are not** 设计推断（非作者历史意图）：
- Benefit: the regex repl in extend_ranges bumps each range endpoint with row >= at by delta, so a totals-below SUM range keeps including the inserted row.
  - Cost: it only rewrites two-cell ranges matching _RANGE — single-cell references are left untouched and the docstring says to validate totals afterwards. [inference: the benefit/cost framing within this implementation is my reading of the repl guard and module docstring.]
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L154–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L154-L169),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L14–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L14-L20)
- **Documented manual procedure for insert-row with post-save diff verification (NOT EXECUTED)** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md documents unpacking, running xlsx_insert_row.py with --at/--text/--values/--formula/--copy-style-from, then repacking with xlsx_pack.py;
  - the EDIT rules require verifying the saved output with `xlsx_reader.py --diff-against input.xlsx` (confirming sheets, named ranges, pivots/macros, and sample data) before delivering.
  - This is a documented procedure only; no automated test covering xlsx_insert_row.py appears in the offered evidence.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L97–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md#L97-L108),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L128–L144](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md#L128-L144)
- **xlsx_insert_row 依赖共享模块 _xlsx_common，后者运行时依赖 lxml** xlsx_insert_row.py 通过 `import _xlsx_common as X` 使用其 first_sheet_name、resolve_worksheet、parse、get_sheetdata、shift_rows、extend_ranges 等助手完成插行；_xlsx_common.py 顶部 `from lxml import etree`，因此该功能运行需要 lxml。所示行未涉及其他脚本的依赖关系。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L25–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L25-L26),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L60–L68](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py#L60-L68),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L8–L10](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py#L8-L10)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-xlsx-insert-row.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L60-L91
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L3-L20
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L50-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L29-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L53-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L71-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L96-L100
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L50-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L50-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L94-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L154-L169
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L14-L20
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L97-L108；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L128-L144
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L25-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py:L60-L68
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py:L8-L10
- 源页字段（feature）：xlsx-insert-row
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_insert_row.py；jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/xlsx_shift_rows.py；jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/_xlsx_common.py
